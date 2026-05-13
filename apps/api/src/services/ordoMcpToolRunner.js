const { prisma } = require("../repositories/prisma");
const { invalidateWorkspace } = require("./workspaceReadCache");
const { mapTeamRow } = require("../routes/teams");
const {
  mapCycle,
  computeCycleStatus,
  buildCycleSummary,
  CYCLE_KINDS,
  parseCycleDateOnlyInput,
  normalizeOptionalUrl
} = require("../routes/cycles");
const { mapIssueToApi } = require("../utils/issueDto");
const { findIssueByRouteParam } = require("./issueRouteLookup");
const { queryIssues } = require("./issueQueryService");
const { bumpIssueNumberCounter } = require("./issueNumberService");
const { buildIssuesId } = require("../utils/issuesId");

async function appendActivity(tx, issueId, type, userId, payload = {}) {
  await tx.issueActivity.create({
    data: {
      issueId,
      type,
      userId,
      payload: payload && typeof payload === "object" ? payload : {}
    }
  });
}

async function usersList(ctx) {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId } });
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return {
    items: members.map((m) => {
      const u = byId[m.userId];
      return {
        userId: m.userId,
        email: u?.email ?? null,
        name: u?.name ?? "Unknown",
        avatarUrl: u?.avatarUrl ?? null,
        role: m.role,
        joinedAt: m.joinedAt.toISOString()
      };
    })
  };
}

async function hasMembership(workspaceId, userId) {
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  return Boolean(m);
}

async function teamsList(ctx) {
  if (!(await hasMembership(ctx.workspaceId, ctx.userId))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const rows = await prisma.team.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" }
  });
  return { items: rows.map(mapTeamRow) };
}

async function teamsGet(ctx, { teamId }) {
  if (!(await hasMembership(ctx.workspaceId, ctx.userId))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId: ctx.workspaceId } });
  if (!team) {
    throw Object.assign(new Error("team not found"), { status: 404 });
  }
  return mapTeamRow(team);
}

async function teamsCreate(ctx, { name, identifier }) {
  if (!name) {
    throw Object.assign(new Error("name is required"), { status: 400 });
  }
  if (!(await hasMembership(ctx.workspaceId, ctx.userId))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const normalizedIdentifier = String(identifier || "")
    .trim()
    .toUpperCase();
  if (normalizedIdentifier && !/^[A-Z][A-Z0-9_-]*$/.test(normalizedIdentifier)) {
    throw Object.assign(new Error("invalid team identifier"), { status: 422 });
  }
  const teamNames = await prisma.team.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { name: true }
  });
  if (teamNames.some((t) => t.name.toLowerCase() === String(name).toLowerCase())) {
    throw Object.assign(new Error("team name already exists"), { status: 409 });
  }
  if (normalizedIdentifier) {
    const rows = await prisma.team.findMany({
      where: { workspaceId: ctx.workspaceId, identifier: { not: null } }
    });
    if (rows.some((t) => String(t.identifier || "").toUpperCase() === normalizedIdentifier)) {
      throw Object.assign(new Error("team identifier already exists"), { status: 409 });
    }
  }
  const TEAM_ACCENT_COLORS = [
    "#4f46e5",
    "#0891b2",
    "#0d9488",
    "#059669",
    "#ca8a04",
    "#d97706",
    "#dc2626",
    "#db2777",
    "#9333ea",
    "#6366f1",
    "#2563eb",
    "#0ea5e9"
  ];
  const DEFAULT_LABELS = [
    { name: "bug", color: "#dc2626" },
    { name: "feature", color: "#2563eb" },
    { name: "docs", color: "#64748b" }
  ];
  const DEFAULT_STATUSES = [
    { key: "todo", label: "Todo" },
    { key: "in_progress", label: "进行中" },
    { key: "in_review", label: "评审中" },
    { key: "done", label: "已完成" }
  ];
  const accentColor = TEAM_ACCENT_COLORS[Math.floor(Math.random() * TEAM_ACCENT_COLORS.length)];
  const team = await prisma.team.create({
    data: {
      workspaceId: ctx.workspaceId,
      name,
      identifier: normalizedIdentifier || null,
      accentColor,
      iterationDurationDays: 14,
      cooldownDays: 2,
      iterationStartWeekday: 1,
      issueLabelsJson: DEFAULT_LABELS,
      issueStatusesJson: DEFAULT_STATUSES
    }
  });
  return mapTeamRow(team);
}

async function teamsUpdate(ctx, { teamId, patch }) {
  if (!(await hasMembership(ctx.workspaceId, ctx.userId))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId: ctx.workspaceId } });
  if (!team) {
    throw Object.assign(new Error("team not found"), { status: 404 });
  }
  const data = patch || {};
  const prismaData = {};
  if (data.name != null) {
    const nm = String(data.name).trim();
    if (!nm) {
      throw Object.assign(new Error("invalid name"), { status: 400 });
    }
    const clash = await prisma.team.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        id: { not: team.id },
        name: { equals: nm, mode: "insensitive" }
      }
    });
    if (clash) {
      throw Object.assign(new Error("team name already exists"), { status: 409 });
    }
    prismaData.name = nm;
  }
  if (data.identifier !== undefined) {
    const normalizedIdentifier = String(data.identifier || "")
      .trim()
      .toUpperCase();
    if (normalizedIdentifier && !/^[A-Z][A-Z0-9_-]*$/.test(normalizedIdentifier)) {
      throw Object.assign(new Error("invalid team identifier"), { status: 422 });
    }
    if (normalizedIdentifier) {
      const rows = await prisma.team.findMany({
        where: { workspaceId: ctx.workspaceId, identifier: { not: null }, id: { not: team.id } }
      });
      if (rows.some((t) => String(t.identifier || "").toUpperCase() === normalizedIdentifier)) {
        throw Object.assign(new Error("team identifier already exists"), { status: 409 });
      }
    }
    prismaData.identifier = normalizedIdentifier || null;
  }
  if (data.accentColor !== undefined) {
    prismaData.accentColor = data.accentColor || null;
  }
  if (data.iterationDurationDays !== undefined) {
    const n = Number(data.iterationDurationDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      throw Object.assign(new Error("invalid iterationDurationDays"), { status: 422 });
    }
    prismaData.iterationDurationDays = Math.round(n);
  }
  if (data.cooldownDays !== undefined) {
    const n = Number(data.cooldownDays);
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      throw Object.assign(new Error("invalid cooldownDays"), { status: 422 });
    }
    prismaData.cooldownDays = Math.round(n);
  }
  if (data.iterationStartWeekday !== undefined) {
    const n = Number(data.iterationStartWeekday);
    if (!Number.isFinite(n) || n < 0 || n > 6) {
      throw Object.assign(new Error("invalid iterationStartWeekday"), { status: 422 });
    }
    prismaData.iterationStartWeekday = Math.round(n);
  }
  if (data.autoCreateDailyCycles !== undefined) {
    if (typeof data.autoCreateDailyCycles !== "boolean") {
      throw Object.assign(new Error("invalid autoCreateDailyCycles"), { status: 422 });
    }
    prismaData.autoCreateDailyCycles = data.autoCreateDailyCycles;
  }
  if (data.issueLabels !== undefined) {
    if (!Array.isArray(data.issueLabels)) {
      throw Object.assign(new Error("issueLabels must be array"), { status: 422 });
    }
    prismaData.issueLabelsJson = data.issueLabels;
  }
  if (data.issueStatuses !== undefined) {
    if (!Array.isArray(data.issueStatuses)) {
      throw Object.assign(new Error("issueStatuses must be array"), { status: 422 });
    }
    prismaData.issueStatusesJson = data.issueStatuses;
  }
  if (data.workflowAutomations !== undefined) {
    prismaData.workflowAutomationsJson = data.workflowAutomations;
  }
  if (data.notificationSettings !== undefined) {
    prismaData.notificationSettingsJson = data.notificationSettings;
  }
  if (Object.keys(prismaData).length === 0) {
    return mapTeamRow(team);
  }
  const updated = await prisma.team.update({
    where: { id: team.id },
    data: prismaData
  });
  return mapTeamRow(updated);
}

async function teamsDelete(ctx, { teamId }) {
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId }
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId: ctx.workspaceId } });
  if (!team) {
    throw Object.assign(new Error("team not found"), { status: 404 });
  }
  await prisma.team.delete({ where: { id: team.id } });
  return { id: team.id, deleted: true };
}

async function cyclesList(ctx, { projectId, teamId } = {}) {
  const rows = await prisma.cycle.findMany({
    where: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      ...(projectId ? { projectId } : {}),
      ...(teamId ? { teamId } : {})
    },
    orderBy: { startsAt: "desc" }
  });
  const items = await Promise.all(
    rows.map(async (cycle) => ({
      ...mapCycle(cycle),
      summary: await buildCycleSummary(ctx.organizationId, cycle.id)
    }))
  );
  return { items };
}

async function cyclesGet(ctx, { cycleId }) {
  const cycle = await prisma.cycle.findFirst({
    where: { id: cycleId, organizationId: ctx.organizationId, workspaceId: ctx.workspaceId }
  });
  if (!cycle) {
    throw Object.assign(new Error("Cycle not found"), { status: 404 });
  }
  return {
    ...mapCycle(cycle),
    summary: await buildCycleSummary(ctx.organizationId, cycle.id)
  };
}

async function cyclesCreate(ctx, body) {
  const {
    name,
    startsAt,
    endsAt,
    projectId = null,
    teamId = null,
    kind: bodyKind,
    plannedTestAt: bodyPlannedTestAt,
    releaseAt: bodyReleaseAt,
    productDocUrl: bodyProductDocUrl,
    designDocUrl: bodyDesignDocUrl,
    uiDocUrl: bodyUiDocUrl
  } = body;
  if (!name || !startsAt || !endsAt) {
    throw Object.assign(new Error("name, startsAt, endsAt are required"), { status: 400 });
  }
  const kind = bodyKind == null || bodyKind === "" ? "daily" : String(bodyKind);
  if (!CYCLE_KINDS.has(kind)) {
    throw Object.assign(new Error("invalid kind (daily | project)"), { status: 422 });
  }
  if (new Date(startsAt) > new Date(endsAt)) {
    throw Object.assign(new Error("startsAt must be before or equal to endsAt"), { status: 422 });
  }
  if (projectId) {
    const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId: ctx.workspaceId } });
    if (!p) {
      throw Object.assign(new Error("invalid projectId"), { status: 422 });
    }
  }
  if (teamId) {
    const t = await prisma.team.findFirst({ where: { id: teamId, workspaceId: ctx.workspaceId } });
    if (!t) {
      throw Object.assign(new Error("invalid teamId"), { status: 422 });
    }
  }
  const createData = {
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    projectId,
    teamId,
    name,
    kind,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    status: computeCycleStatus(startsAt, endsAt)
  };
  if (Object.prototype.hasOwnProperty.call(body || {}, "plannedTestAt")) {
    const p = parseCycleDateOnlyInput(bodyPlannedTestAt);
    if (p === undefined) {
      throw Object.assign(new Error("invalid plannedTestAt date (YYYY-MM-DD or ISO)"), { status: 422 });
    }
    createData.plannedTestAt = p;
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "releaseAt")) {
    const p = parseCycleDateOnlyInput(bodyReleaseAt);
    if (p === undefined) {
      throw Object.assign(new Error("invalid releaseAt date (YYYY-MM-DD or ISO)"), { status: 422 });
    }
    createData.releaseAt = p;
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "productDocUrl")) {
    createData.productDocUrl = normalizeOptionalUrl(bodyProductDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "designDocUrl")) {
    createData.designDocUrl = normalizeOptionalUrl(bodyDesignDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "uiDocUrl")) {
    createData.uiDocUrl = normalizeOptionalUrl(bodyUiDocUrl);
  }
  const row = await prisma.cycle.create({ data: createData });
  invalidateWorkspace(ctx.workspaceId);
  return mapCycle(row);
}

async function cyclesUpdate(ctx, { cycleId, patch }) {
  const cycle = await prisma.cycle.findFirst({
    where: { id: cycleId, organizationId: ctx.organizationId, workspaceId: ctx.workspaceId }
  });
  if (!cycle) {
    throw Object.assign(new Error("Cycle not found"), { status: 404 });
  }
  const data = {};
  const p = patch || {};
  if (p.name != null) {
    const n = String(p.name).trim();
    if (!n) {
      throw Object.assign(new Error("invalid name"), { status: 400 });
    }
    data.name = n;
  }
  if (p.startsAt != null) {
    data.startsAt = new Date(p.startsAt);
  }
  if (p.endsAt != null) {
    data.endsAt = new Date(p.endsAt);
  }
  if (p.projectId !== undefined) {
    if (p.projectId == null || p.projectId === "") {
      data.projectId = null;
    } else {
      const proj = await prisma.project.findFirst({ where: { id: p.projectId, workspaceId: ctx.workspaceId } });
      if (!proj) {
        throw Object.assign(new Error("invalid projectId"), { status: 422 });
      }
      data.projectId = p.projectId;
    }
  }
  if (p.teamId !== undefined) {
    if (p.teamId == null || p.teamId === "") {
      data.teamId = null;
    } else {
      const t = await prisma.team.findFirst({ where: { id: p.teamId, workspaceId: ctx.workspaceId } });
      if (!t) {
        throw Object.assign(new Error("invalid teamId"), { status: 422 });
      }
      data.teamId = p.teamId;
    }
  }
  if (p.status != null) {
    const s = String(p.status);
    if (!["planned", "active", "closed"].includes(s)) {
      throw Object.assign(new Error("invalid status"), { status: 422 });
    }
    data.status = s;
  }
  if (Object.prototype.hasOwnProperty.call(p, "kind")) {
    const k = p.kind == null || p.kind === "" ? "daily" : String(p.kind);
    if (!CYCLE_KINDS.has(k)) {
      throw Object.assign(new Error("invalid kind (daily | project)"), { status: 422 });
    }
    data.kind = k;
    if (k === "daily") {
      data.productDocUrl = null;
      data.designDocUrl = null;
      data.uiDocUrl = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(p, "plannedTestAt")) {
    const parsed = parseCycleDateOnlyInput(p.plannedTestAt);
    if (parsed === undefined) {
      throw Object.assign(new Error("invalid plannedTestAt date (YYYY-MM-DD or ISO)"), { status: 422 });
    }
    data.plannedTestAt = parsed;
  }
  if (Object.prototype.hasOwnProperty.call(p, "releaseAt")) {
    const parsed = parseCycleDateOnlyInput(p.releaseAt);
    if (parsed === undefined) {
      throw Object.assign(new Error("invalid releaseAt date (YYYY-MM-DD or ISO)"), { status: 422 });
    }
    data.releaseAt = parsed;
  }
  if (Object.prototype.hasOwnProperty.call(p, "productDocUrl")) {
    data.productDocUrl = normalizeOptionalUrl(p.productDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(p, "designDocUrl")) {
    data.designDocUrl = normalizeOptionalUrl(p.designDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(p, "uiDocUrl")) {
    data.uiDocUrl = normalizeOptionalUrl(p.uiDocUrl);
  }
  const effectiveKind =
    data.kind != null
      ? data.kind
      : cycle.kind && CYCLE_KINDS.has(String(cycle.kind))
        ? String(cycle.kind)
        : "daily";
  if (
    effectiveKind === "daily" &&
    !Object.prototype.hasOwnProperty.call(p, "kind") &&
    (Object.prototype.hasOwnProperty.call(p, "productDocUrl") ||
      Object.prototype.hasOwnProperty.call(p, "designDocUrl") ||
      Object.prototype.hasOwnProperty.call(p, "uiDocUrl"))
  ) {
    throw Object.assign(new Error("doc URLs apply to project iterations only (kind project)"), {
      status: 422
    });
  }
  const nextStart = data.startsAt != null ? data.startsAt : cycle.startsAt;
  const nextEnd = data.endsAt != null ? data.endsAt : cycle.endsAt;
  if (nextStart > nextEnd) {
    throw Object.assign(new Error("startsAt must be before or equal to endsAt"), { status: 422 });
  }
  if (Object.keys(data).length === 0) {
    return mapCycle(cycle);
  }
  if (data.startsAt != null || data.endsAt != null) {
    if (data.status == null) {
      data.status = computeCycleStatus(nextStart, nextEnd);
    }
  }
  const updated = await prisma.cycle.update({
    where: { id: cycle.id },
    data: { ...data, updatedAt: new Date() }
  });
  invalidateWorkspace(ctx.workspaceId);
  return mapCycle(updated);
}

async function cyclesDelete(ctx, { cycleId }) {
  const cycle = await prisma.cycle.findFirst({
    where: { id: cycleId, organizationId: ctx.organizationId, workspaceId: ctx.workspaceId }
  });
  if (!cycle) {
    throw Object.assign(new Error("Cycle not found"), { status: 404 });
  }
  await prisma.cycle.delete({ where: { id: cycle.id } });
  invalidateWorkspace(ctx.workspaceId);
  return { id: cycle.id, deleted: true };
}

async function issuesList(ctx, { status, teamId, page, pageSize } = {}) {
  return queryIssues({
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    status,
    teamId,
    page,
    pageSize
  });
}

async function issuesGet(ctx, { issueId }) {
  const slim = await findIssueByRouteParam(String(issueId), ctx);
  if (!slim) {
    throw Object.assign(new Error("Issue not found"), { status: 404 });
  }
  const issue = await prisma.issue.findUnique({
    where: { id: slim.id },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      activities: { orderBy: { createdAt: "asc" } },
      subtasks: { orderBy: { createdAt: "asc" } },
      parent: { select: { id: true, title: true, issuesId: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fileName: true,
          contentType: true,
          size: true,
          uploadedById: true,
          createdAt: true
        }
      }
    }
  });
  return mapIssueToApi(issue, {
    includeComments: true,
    includeActivity: true,
    includeSubtasks: true,
    includeParent: true,
    includeAttachments: true
  });
}

async function issuesCreate(ctx, body) {
  const {
    projectId,
    teamId = null,
    title,
    description = null,
    cycleId = null,
    status = "todo",
    priority = 0,
    type = "feature",
    estimateHours = null,
    assigneeId = null,
    labels = [],
    dueDate = null
  } = body;
  const rawTitle = String(title ?? "").trim();
  if (!rawTitle) {
    throw Object.assign(new Error("title is required"), { status: 400 });
  }
  if (!projectId) {
    throw Object.assign(new Error("projectId is required for MCP create"), { status: 400 });
  }
  if (!["feature", "bug", "chore"].includes(type)) {
    throw Object.assign(new Error("invalid type"), { status: 422 });
  }
  const pr = Math.round(Number(priority));
  if (!Number.isFinite(pr) || !Number.isInteger(pr) || pr < 0 || pr > 4) {
    throw Object.assign(new Error("invalid priority"), { status: 422 });
  }
  if (!["todo", "in_progress", "in_review", "done"].includes(status)) {
    throw Object.assign(new Error("invalid status"), { status: 422 });
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, workspaceId: true, organizationId: true, key: true }
  });
  if (!project || project.workspaceId !== ctx.workspaceId) {
    throw Object.assign(new Error("project not found"), { status: 400 });
  }
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: project.workspaceId, userId: ctx.userId }
  });
  if (!member) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const workspaceId = project.workspaceId;
  const organizationId = project.organizationId;
  let team = null;
  if (teamId) {
    team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
    if (!team) {
      throw Object.assign(new Error("Invalid teamId for workspace"), { status: 400 });
    }
  }
  let resolvedCycleId = cycleId || null;
  if (resolvedCycleId) {
    const rowC = await prisma.cycle.findFirst({ where: { id: resolvedCycleId, workspaceId } });
    if (!rowC) {
      throw Object.assign(new Error("invalid cycleId for workspace"), { status: 400 });
    }
  }
  const identifier = String(team?.identifier || project.key || "")
    .trim()
    .toUpperCase();
  const scopeKey = identifier ? `identifier:${identifier}` : `project:${projectId}`;
  const labelsArr = Array.isArray(labels) ? labels : [];
  const due = dueDate ? new Date(dueDate) : null;
  const prefixForIssuesId =
    String(identifier || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "") ||
    String(project.key || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "") ||
    "";
  const created = await prisma.$transaction(async (tx) => {
    const issueNumber = await bumpIssueNumberCounter(tx, workspaceId, scopeKey);
    let issuesId = String(buildIssuesId(prefixForIssuesId || "X", issueNumber)).trim();
    if (!issuesId) {
      issuesId = `X-${issueNumber}`;
    }
    const row = await tx.issue.create({
      data: {
        organizationId,
        workspaceId,
        teamId,
        projectId,
        parentIssueId: null,
        cycleId: resolvedCycleId,
        title: rawTitle,
        description: description ?? null,
        status,
        priority: pr,
        type,
        estimateHours: estimateHours == null ? null : Number(estimateHours),
        assigneeId: assigneeId || null,
        labels: labelsArr,
        dueDate: due,
        displayIdentifier: identifier || null,
        numberScope: scopeKey,
        issueNumber,
        issuesId
      }
    });
    await appendActivity(tx, row.id, "issue_created", ctx.userId, {
      title: row.title,
      projectId: row.projectId
    });
    return row;
  });
  invalidateWorkspace(ctx.workspaceId);
  return mapIssueToApi(created);
}

async function issuesUpdate(ctx, { issueId, patch }) {
  const issue = await findIssueByRouteParam(String(issueId), ctx);
  if (!issue) {
    throw Object.assign(new Error("Issue not found"), { status: 404 });
  }
  const changes = patch || {};
  const data = {};
  if (changes.title !== undefined) {
    data.title = changes.title == null ? "" : String(changes.title).trim() || null;
  }
  if (changes.description !== undefined) {
    data.description = changes.description == null ? null : String(changes.description);
  }
  if (changes.status !== undefined) {
    if (!["todo", "in_progress", "in_review", "done"].includes(changes.status)) {
      throw Object.assign(new Error("invalid status"), { status: 422 });
    }
    data.status = changes.status;
  }
  if (changes.priority !== undefined) {
    const p = Math.round(Number(changes.priority));
    if (!Number.isInteger(p) || p < 0 || p > 4) {
      throw Object.assign(new Error("invalid priority"), { status: 422 });
    }
    data.priority = p;
  }
  if (changes.type !== undefined) {
    if (!["feature", "bug", "chore"].includes(changes.type)) {
      throw Object.assign(new Error("invalid type"), { status: 422 });
    }
    data.type = changes.type;
  }
  if (changes.estimateHours !== undefined) {
    data.estimateHours =
      changes.estimateHours == null || changes.estimateHours === "" ? null : Number(changes.estimateHours);
  }
  if (changes.assigneeId !== undefined) {
    data.assigneeId = changes.assigneeId == null || changes.assigneeId === "" ? null : String(changes.assigneeId);
  }
  if (changes.labels !== undefined) {
    if (!Array.isArray(changes.labels)) {
      throw Object.assign(new Error("labels must be array"), { status: 422 });
    }
    data.labels = changes.labels.map(String);
  }
  if (changes.dueDate !== undefined) {
    data.dueDate = changes.dueDate == null || changes.dueDate === "" ? null : new Date(changes.dueDate);
  }
  if (changes.projectId !== undefined) {
    const p = await prisma.project.findFirst({
      where: { id: changes.projectId, workspaceId: ctx.workspaceId }
    });
    if (!p) {
      throw Object.assign(new Error("invalid projectId"), { status: 422 });
    }
    data.projectId = changes.projectId;
  }
  if (changes.teamId !== undefined) {
    if (changes.teamId == null || changes.teamId === "") {
      data.teamId = null;
    } else {
      const t = await prisma.team.findFirst({ where: { id: changes.teamId, workspaceId: ctx.workspaceId } });
      if (!t) {
        throw Object.assign(new Error("invalid teamId"), { status: 422 });
      }
      data.teamId = changes.teamId;
    }
  }
  if (changes.cycleId !== undefined) {
    if (changes.cycleId == null || changes.cycleId === "") {
      data.cycleId = null;
    } else {
      const rowC = await prisma.cycle.findFirst({
        where: { id: changes.cycleId, workspaceId: ctx.workspaceId }
      });
      if (!rowC) {
        throw Object.assign(new Error("invalid cycleId"), { status: 422 });
      }
      data.cycleId = changes.cycleId;
    }
  }
  if (Object.keys(data).length === 0) {
    const full = await prisma.issue.findUnique({ where: { id: issue.id } });
    return mapIssueToApi(full);
  }
  data.updatedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.issue.update({
      where: { id: issue.id },
      data
    });
    await appendActivity(tx, issue.id, "issue_updated", ctx.userId, { changes: patch });
    return row;
  });
  invalidateWorkspace(ctx.workspaceId);
  return mapIssueToApi(updated);
}

async function issuesDelete(ctx, { issueId }) {
  const issue = await findIssueByRouteParam(String(issueId), ctx);
  if (!issue) {
    throw Object.assign(new Error("Issue not found"), { status: 404 });
  }
  await prisma.issue.delete({ where: { id: issue.id } });
  invalidateWorkspace(ctx.workspaceId);
  return { id: issue.id, deleted: true };
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {{ userId: string, workspaceId: string, organizationId: string }} ctx
 */
async function runOrdoMcpTool(toolName, args, ctx) {
  switch (toolName) {
    case "ordo_users_list":
      return usersList(ctx);
    case "ordo_teams_list":
      return teamsList(ctx);
    case "ordo_teams_get":
      return teamsGet(ctx, args);
    case "ordo_teams_create":
      return teamsCreate(ctx, args);
    case "ordo_teams_update":
      return teamsUpdate(ctx, args);
    case "ordo_teams_delete":
      return teamsDelete(ctx, args);
    case "ordo_cycles_list":
      return cyclesList(ctx, args);
    case "ordo_cycles_get":
      return cyclesGet(ctx, args);
    case "ordo_cycles_create":
      return cyclesCreate(ctx, args);
    case "ordo_cycles_update":
      return cyclesUpdate(ctx, args);
    case "ordo_cycles_delete":
      return cyclesDelete(ctx, args);
    case "ordo_issues_list":
      return issuesList(ctx, args);
    case "ordo_issues_get":
      return issuesGet(ctx, args);
    case "ordo_issues_create":
      return issuesCreate(ctx, args);
    case "ordo_issues_update":
      return issuesUpdate(ctx, args);
    case "ordo_issues_delete":
      return issuesDelete(ctx, args);
    default:
      throw Object.assign(new Error(`unknown tool: ${toolName}`), { status: 400 });
  }
}

module.exports = { runOrdoMcpTool };
