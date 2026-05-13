const express = require("express");

const { prisma } = require("../repositories/prisma");
const {
  notifyTeamsDingTalk,
  formatCycleNotifyCreated,
  buildCyclesListDeepLink,
  buildWorkspaceHomeDeepLink,
  publicWebBase
} = require("../services/teamNotifications");
const { summarizeCycleIssues, fetchCycleSummary } = require("../services/cycleSummary");
const { makeKey, getJson, setJson, invalidateWorkspace } = require("../services/workspaceReadCache");



const cyclesRouter = express.Router();



function computeCycleStatus(startsAt, endsAt, now = new Date()) {

  const start = new Date(startsAt);

  const end = new Date(endsAt);

  if (now < start) {

    return "planned";

  }

  if (now > end) {

    return "closed";

  }

  return "active";

}

const CYCLE_KINDS = new Set(["daily", "project"]);

function parseCycleDateOnlyInput(v) {
  if (v == null || v === "") {
    return null;
  }
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return v;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  const fromIso = new Date(s);
  return Number.isFinite(fromIso.getTime()) ? fromIso : undefined;
}

function normalizeOptionalUrl(v) {
  if (v == null || v === "") {
    return null;
  }
  const t = String(v).trim();
  return t === "" ? null : t.slice(0, 2048);
}

const MAX_RELEASE_CONDITIONS = 40;
const MAX_RELEASE_CONDITION_TEXT = 600;

function mapReleaseConditionsFromJson(json) {
  if (!Array.isArray(json)) {
    return [];
  }
  return json
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const text = String(x.text ?? "").slice(0, MAX_RELEASE_CONDITION_TEXT);
      const status =
        x.status === "done" || x.status === "completed" || x.status === "已完成" ? "done" : "pending";
      return { text, status };
    })
    .filter((x) => x.text.trim() !== "");
}

function normalizeReleaseConditionsForWrite(input) {
  if (!Array.isArray(input)) {
    return null;
  }
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    if (out.length >= MAX_RELEASE_CONDITIONS) {
      break;
    }
    const text = String(raw.text ?? "")
      .trim()
      .slice(0, MAX_RELEASE_CONDITION_TEXT);
    if (text === "") {
      continue;
    }
    const st =
      raw.status === "done" || raw.status === "completed" || raw.status === "已完成" ? "done" : "pending";
    out.push({ text, status: st });
  }
  return out.length ? out : null;
}

async function buildCycleSummary(organizationId, cycleId) {
  return fetchCycleSummary(prisma, organizationId, cycleId);
}



function mapCycle(row) {
  const kind =
    row.kind && CYCLE_KINDS.has(String(row.kind)) ? String(row.kind) : "daily";
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    teamId: row.teamId,
    name: row.name,
    kind,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    plannedTestAt: row.plannedTestAt ? row.plannedTestAt.toISOString() : null,
    releaseAt: row.releaseAt ? row.releaseAt.toISOString() : null,
    productDocUrl: row.productDocUrl ?? null,
    designDocUrl: row.designDocUrl ?? null,
    uiDocUrl: row.uiDocUrl ?? null,
    releaseConditions: mapReleaseConditionsFromJson(row.releaseConditionsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}



cyclesRouter.post("/", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const {
    projectId = null,
    teamId = null,
    name,
    startsAt,
    endsAt,
    kind: bodyKind,
    plannedTestAt: bodyPlannedTestAt,
    releaseAt: bodyReleaseAt,
    productDocUrl: bodyProductDocUrl,
    designDocUrl: bodyDesignDocUrl,
    uiDocUrl: bodyUiDocUrl,
    releaseConditions: bodyReleaseConditions
  } = req.body ?? {};

  const kind = bodyKind == null || bodyKind === "" ? "daily" : String(bodyKind);
  if (!CYCLE_KINDS.has(kind)) {
    return res.status(422).json({ message: "invalid kind (daily | project)" });
  }

  if (!name || !startsAt || !endsAt) {

    return res.status(400).json({ message: "name, startsAt, endsAt are required" });

  }

  if (new Date(startsAt) > new Date(endsAt)) {

    return res.status(422).json({ message: "startsAt must be before or equal to endsAt" });

  }



  if (projectId) {

    const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId } });

    if (!p) {

      return res.status(422).json({ message: "invalid projectId" });

    }

  }

  if (teamId) {

    const t = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });

    if (!t) {

      return res.status(422).json({ message: "invalid teamId" });

    }

  }



  let plannedTestAtParsed = null;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "plannedTestAt")) {
    const p = parseCycleDateOnlyInput(bodyPlannedTestAt);
    if (p === undefined) {
      return res.status(422).json({ message: "invalid plannedTestAt date (YYYY-MM-DD or ISO)" });
    }
    plannedTestAtParsed = p;
  }
  let releaseAtParsed = null;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "releaseAt")) {
    const p = parseCycleDateOnlyInput(bodyReleaseAt);
    if (p === undefined) {
      return res.status(422).json({ message: "invalid releaseAt date (YYYY-MM-DD or ISO)" });
    }
    releaseAtParsed = p;
  }
  let productDocUrlVal = undefined;
  let designDocUrlVal = undefined;
  let uiDocUrlVal = undefined;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "productDocUrl")) {
    productDocUrlVal = normalizeOptionalUrl(bodyProductDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "designDocUrl")) {
    designDocUrlVal = normalizeOptionalUrl(bodyDesignDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "uiDocUrl")) {
    uiDocUrlVal = normalizeOptionalUrl(bodyUiDocUrl);
  }

  let releaseConditionsJsonVal;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "releaseConditions")) {
    if (!Array.isArray(bodyReleaseConditions)) {
      return res.status(422).json({ message: "releaseConditions must be an array" });
    }
    releaseConditionsJsonVal = normalizeReleaseConditionsForWrite(bodyReleaseConditions);
  }

  const row = await prisma.cycle.create({
    data: {
      organizationId,
      workspaceId,
      projectId,
      teamId,
      name,
      kind,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: computeCycleStatus(startsAt, endsAt),
      ...(plannedTestAtParsed !== null || Object.prototype.hasOwnProperty.call(req.body || {}, "plannedTestAt")
        ? { plannedTestAt: plannedTestAtParsed }
        : {}),
      ...(releaseAtParsed !== null || Object.prototype.hasOwnProperty.call(req.body || {}, "releaseAt")
        ? { releaseAt: releaseAtParsed }
        : {}),
      ...(productDocUrlVal !== undefined ? { productDocUrl: productDocUrlVal } : {}),
      ...(designDocUrlVal !== undefined ? { designDocUrl: designDocUrlVal } : {}),
      ...(uiDocUrlVal !== undefined ? { uiDocUrl: uiDocUrlVal } : {}),
      ...(releaseConditionsJsonVal !== undefined ? { releaseConditionsJson: releaseConditionsJsonVal } : {})
    }
  });

  void (async () => {
    const [workspaceRow, teamRow, projRow] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: row.workspaceId }, select: { url: true } }),
      row.teamId ? prisma.team.findUnique({ where: { id: row.teamId }, select: { id: true, name: true } }) : null,
      row.projectId ? prisma.project.findFirst({ where: { id: row.projectId }, select: { key: true } }) : null
    ]);
    const base = publicWebBase();
    const landingUrl =
      buildCyclesListDeepLink(base, workspaceRow?.url, teamRow) ||
      buildWorkspaceHomeDeepLink(base, workspaceRow?.url);
    await notifyTeamsDingTalk({
      workspaceId: row.workspaceId,
      teamId: row.teamId,
      text: formatCycleNotifyCreated({
        name: row.name,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        status: row.status,
        projectKey: projRow?.key || null,
        landingUrl
      })
    });
  })().catch((e) => {
    console.warn("[notify:dingtalk] cycle created send failed", e?.message || e);
  });
  invalidateWorkspace(workspaceId);

  return res.status(201).json(mapCycle(row));

});



cyclesRouter.get("/", async (req, res) => {
  const organizationId = req.context.organizationId;
  const workspaceId = req.context.workspaceId;
  const { projectId, teamId } = req.query;
  const qKey = makeKey([
    "v1",
    workspaceId,
    "cycles",
    organizationId,
    projectId ? String(projectId) : "",
    teamId ? String(teamId) : ""
  ]);
  const hit = getJson(qKey);
  if (hit) {
    return res.json(hit);
  }

  const rows = await prisma.cycle.findMany({
    where: {
      organizationId,
      workspaceId,
      ...(projectId ? { projectId } : {}),
      ...(teamId ? { teamId } : {})
    },
    orderBy: { startsAt: "desc" }
  });

  if (rows.length === 0) {
    const body = { items: [] };
    setJson(qKey, body);
    return res.json(body);
  }

  const cycleIds = rows.map((r) => r.id);
  const issuesAll = await prisma.issue.findMany({
    where: { organizationId, cycleId: { in: cycleIds } },
    select: { cycleId: true, status: true, type: true, estimateHours: true }
  });

  const issuesByCycle = new Map();
  for (const iss of issuesAll) {
    const cid = iss.cycleId;
    if (!cid) {
      continue;
    }
    if (!issuesByCycle.has(cid)) {
      issuesByCycle.set(cid, []);
    }
    issuesByCycle.get(cid).push(iss);
  }

  const items = rows.map((cycle) => {
    const issues = issuesByCycle.get(cycle.id) || [];
    return {
      ...mapCycle(cycle),
      summary: summarizeCycleIssues(issues)
    };
  });

  const body = { items };
  setJson(qKey, body);
  return res.json(body);
});

cyclesRouter.get("/team-metrics", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const teamId = req.query.teamId;

  if (!teamId) {

    return res.status(400).json({ message: "teamId is required" });

  }



  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });

  if (!team) {

    return res.status(404).json({ message: "team not found" });

  }



  const issues = await prisma.issue.findMany({
    where: { workspaceId, organizationId, teamId },
    select: { status: true, type: true, cycleId: true, estimateHours: true }
  });

  const byStatus = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
  const byType = { feature: 0, bug: 0, chore: 0 };
  const byEstimate = { unset: 0, lte2: 0, mid: 0, gte8: 0 };
  let estimateSum = 0;

  for (const row of issues) {
    const st = row.status;
    byStatus[st] = (byStatus[st] || 0) + 1;
    const tp = row.type;
    byType[tp] = (byType[tp] || 0) + 1;
    estimateSum += Number(row.estimateHours) || 0;
    const h = row.estimateHours;
    if (h == null || !Number.isFinite(Number(h))) {
      byEstimate.unset += 1;
    } else {
      const n = Number(h);
      if (n <= 2) {
        byEstimate.lte2 += 1;
      } else if (n >= 8) {
        byEstimate.gte8 += 1;
      } else {
        byEstimate.mid += 1;
      }
    }
  }

  return res.json({
    teamId: team.id,
    teamName: team.name,
    issueTotals: {
      count: issues.length,
      estimateHours: estimateSum,
      byStatus,
      byType,
      byEstimate
    }
  });

});

cyclesRouter.get("/:id/report", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const cycle = await prisma.cycle.findFirst({

    where: { id: req.params.id, organizationId, workspaceId }

  });

  if (!cycle) {

    return res.status(404).json({ message: "Cycle not found" });

  }



  const issues = await prisma.issue.findMany({

    where: { organizationId, cycleId: cycle.id },

    select: { status: true, estimateHours: true }

  });

  const totalIssues = issues.length;

  const doneIssues = issues.filter((issue) => issue.status === "done").length;

  const byStatus = issues.reduce(

    (acc, issue) => {

      acc[issue.status] = (acc[issue.status] || 0) + 1;

      return acc;

    },

    { todo: 0, in_progress: 0, in_review: 0, done: 0 }

  );

  const totalEstimateHours = issues.reduce((acc, issue) => acc + (Number(issue.estimateHours) || 0), 0);

  const doneEstimateHours = issues

    .filter((issue) => issue.status === "done")

    .reduce((acc, issue) => acc + (Number(issue.estimateHours) || 0), 0);



  return res.json({

    cycleId: cycle.id,

    cycleName: cycle.name,

    totalIssues,

    doneIssues,

    completionRate: totalIssues === 0 ? 0 : Number(((doneIssues / totalIssues) * 100).toFixed(2)),

    byStatus,

    totalEstimateHours,

    doneEstimateHours,

    remainingEstimateHours: totalEstimateHours - doneEstimateHours

  });

});

cyclesRouter.get("/:id", async (req, res) => {
  const organizationId = req.context.organizationId;
  const workspaceId = req.context.workspaceId;
  const cycle = await prisma.cycle.findFirst({
    where: { id: req.params.id, organizationId, workspaceId }
  });
  if (!cycle) {
    return res.status(404).json({ message: "Cycle not found" });
  }
  return res.json({
    ...mapCycle(cycle),
    summary: await buildCycleSummary(organizationId, cycle.id)
  });
});

cyclesRouter.patch("/:id", async (req, res) => {
  const organizationId = req.context.organizationId;
  const workspaceId = req.context.workspaceId;
  const cycle = await prisma.cycle.findFirst({
    where: { id: req.params.id, organizationId, workspaceId }
  });
  if (!cycle) {
    return res.status(404).json({ message: "Cycle not found" });
  }
  const body = req.body ?? {};
  const {
    name,
    startsAt,
    endsAt,
    projectId,
    teamId,
    status,
    kind: patchKind,
    plannedTestAt: patchPlannedTestAt,
    releaseAt: patchReleaseAt,
    productDocUrl: patchProductDocUrl,
    designDocUrl: patchDesignDocUrl,
    uiDocUrl: patchUiDocUrl,
    releaseConditions: patchReleaseConditions
  } = body;
  const data = {};
  if (name != null) {
    const n = String(name).trim();
    if (!n) {
      return res.status(400).json({ message: "invalid name" });
    }
    data.name = n;
  }
  if (startsAt != null) {
    data.startsAt = new Date(startsAt);
  }
  if (endsAt != null) {
    data.endsAt = new Date(endsAt);
  }
  if (projectId !== undefined) {
    if (projectId == null || projectId === "") {
      data.projectId = null;
    } else {
      const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId } });
      if (!p) {
        return res.status(422).json({ message: "invalid projectId" });
      }
      data.projectId = projectId;
    }
  }
  if (teamId !== undefined) {
    if (teamId == null || teamId === "") {
      data.teamId = null;
    } else {
      const t = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
      if (!t) {
        return res.status(422).json({ message: "invalid teamId" });
      }
      data.teamId = teamId;
    }
  }
  if (status != null) {
    const s = String(status);
    if (!["planned", "active", "closed"].includes(s)) {
      return res.status(422).json({ message: "invalid status" });
    }
    data.status = s;
  }
  if (Object.prototype.hasOwnProperty.call(body, "kind")) {
    const k = patchKind == null || patchKind === "" ? "daily" : String(patchKind);
    if (!CYCLE_KINDS.has(k)) {
      return res.status(422).json({ message: "invalid kind (daily | project)" });
    }
    data.kind = k;
    if (k === "daily") {
      data.productDocUrl = null;
      data.designDocUrl = null;
      data.uiDocUrl = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "plannedTestAt")) {
    const parsed = parseCycleDateOnlyInput(patchPlannedTestAt);
    if (parsed === undefined) {
      return res.status(422).json({ message: "invalid plannedTestAt date (YYYY-MM-DD or ISO)" });
    }
    data.plannedTestAt = parsed;
  }
  if (Object.prototype.hasOwnProperty.call(body, "releaseAt")) {
    const parsed = parseCycleDateOnlyInput(patchReleaseAt);
    if (parsed === undefined) {
      return res.status(422).json({ message: "invalid releaseAt date (YYYY-MM-DD or ISO)" });
    }
    data.releaseAt = parsed;
  }
  if (Object.prototype.hasOwnProperty.call(body, "productDocUrl")) {
    data.productDocUrl = normalizeOptionalUrl(patchProductDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "designDocUrl")) {
    data.designDocUrl = normalizeOptionalUrl(patchDesignDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "uiDocUrl")) {
    data.uiDocUrl = normalizeOptionalUrl(patchUiDocUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "releaseConditions")) {
    if (!Array.isArray(patchReleaseConditions)) {
      return res.status(422).json({ message: "releaseConditions must be an array" });
    }
    data.releaseConditionsJson = normalizeReleaseConditionsForWrite(patchReleaseConditions);
  }
  const effectiveKind =
    data.kind != null
      ? data.kind
      : cycle.kind && CYCLE_KINDS.has(String(cycle.kind))
        ? String(cycle.kind)
        : "daily";
  /** 仅禁止「日常迭代」上写入非空文档链接；清空/null（含切换类型后延迟 blur）应放行 */
  const docProduct = Object.prototype.hasOwnProperty.call(body, "productDocUrl")
    ? normalizeOptionalUrl(patchProductDocUrl)
    : undefined;
  const docDesign = Object.prototype.hasOwnProperty.call(body, "designDocUrl")
    ? normalizeOptionalUrl(patchDesignDocUrl)
    : undefined;
  const docUi = Object.prototype.hasOwnProperty.call(body, "uiDocUrl") ? normalizeOptionalUrl(patchUiDocUrl) : undefined;
  const wantsNonEmptyDocOnDaily =
    effectiveKind === "daily" &&
    !Object.prototype.hasOwnProperty.call(body, "kind") &&
    (docProduct != null || docDesign != null || docUi != null);
  if (wantsNonEmptyDocOnDaily) {
    return res.status(422).json({ message: "doc URLs apply to project iterations only (kind project)" });
  }
  const nextStart = data.startsAt != null ? data.startsAt : cycle.startsAt;
  const nextEnd = data.endsAt != null ? data.endsAt : cycle.endsAt;
  if (nextStart > nextEnd) {
    return res.status(422).json({ message: "startsAt must be before or equal to endsAt" });
  }
  if (Object.keys(data).length === 0) {
    return res.json(mapCycle(cycle));
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
  invalidateWorkspace(workspaceId);
  return res.json(mapCycle(updated));
});

cyclesRouter.delete("/:id", async (req, res) => {
  const organizationId = req.context.organizationId;
  const workspaceId = req.context.workspaceId;
  const cycle = await prisma.cycle.findFirst({
    where: { id: req.params.id, organizationId, workspaceId }
  });
  if (!cycle) {
    return res.status(404).json({ message: "Cycle not found" });
  }
  await prisma.cycle.delete({ where: { id: cycle.id } });
  invalidateWorkspace(workspaceId);
  return res.json({ id: cycle.id, deleted: true });
});

module.exports = {
  cyclesRouter,
  mapCycle,
  computeCycleStatus,
  buildCycleSummary,
  CYCLE_KINDS,
  parseCycleDateOnlyInput,
  normalizeOptionalUrl,
  normalizeReleaseConditionsForWrite,
  mapReleaseConditionsFromJson
};

