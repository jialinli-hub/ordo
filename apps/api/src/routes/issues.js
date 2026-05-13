const express = require("express");
const { prisma } = require("../repositories/prisma");
const { bumpIssueNumberCounter } = require("../services/issueNumberService");
const { issueAllowedForWorkspaceContext } = require("../services/issueWorkspaceScope");
const { mapIssueToApi } = require("../utils/issueDto");
const { buildIssuesId } = require("../utils/issuesId");
const { findIssueByRouteParam } = require("../services/issueRouteLookup");
const {
  notifyTeamsDingTalk,
  formatIssueNotify,
  buildIssueDeepLink
} = require("../services/teamNotifications");
const { invalidateWorkspace } = require("../services/workspaceReadCache");

const issuesRouter = express.Router();
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const issueDetailInclude = {
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
};

function sanitizeAttachmentFileName(raw) {
  const s = String(raw || "").replace(/\\/g, "/");
  const base = s.split("/").pop()?.trim() || "file";
  const t = base.slice(0, 255);
  return t || "file";
}

async function appendActivity(prismaClient, issueId, type, userId, payload = {}) {
  await prismaClient.issueActivity.create({
    data: {
      issueId,
      type,
      userId,
      payload: payload && typeof payload === "object" ? payload : {}
    }
  });
}

function eqScalar(a, b) {
  const x = a == null ? null : a;
  const y = b == null ? null : b;
  return x === y;
}

function eqStringish(a, b) {
  const x = a == null ? "" : String(a);
  const y = b == null ? "" : String(b);
  return x === y;
}

function normalizeStringOrNull(v) {
  const s = v == null ? "" : String(v);
  const t = s.trim();
  return t === "" ? null : t;
}

function normalizeNumberOrNull(v) {
  if (v == null || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function normalizeLabels(v) {
  if (!Array.isArray(v)) return null;
  return v.map((x) => String(x)).filter((s) => s.trim() !== "");
}

function sameStringArray(a, b) {
  const x = Array.isArray(a) ? a.map(String) : [];
  const y = Array.isArray(b) ? b.map(String) : [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

async function loadUsersForDingTalkNotify(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) {
    return new Map();
  }
  const rows = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: {
      id: true,
      name: true,
      dingTalkUnionId: true,
      dingTalkMobile: true,
      dingTalkUserId: true,
      dingTalkStaffId: true
    }
  });
  return new Map(rows.map((u) => [u.id, u]));
}

/** 任务钉钉：工作区 slug、迭代名、项目 key、深链、相关用户 Map */
async function loadIssueDingTalkSideContext(issueRow, userIdsForMap) {
  const uniq = [...new Set((Array.isArray(userIdsForMap) ? userIdsForMap : []).filter(Boolean))];
  const [userMap, workspaceRow, cycleRow, proj] = await Promise.all([
    loadUsersForDingTalkNotify(uniq),
    prisma.workspace.findUnique({
      where: { id: issueRow.workspaceId },
      select: { url: true }
    }),
    issueRow.cycleId
      ? prisma.cycle.findUnique({ where: { id: issueRow.cycleId }, select: { name: true } })
      : Promise.resolve(null),
    issueRow.projectId
      ? prisma.project.findFirst({ where: { id: issueRow.projectId }, select: { key: true } })
      : Promise.resolve(null)
  ]);
  const publicBase = String(process.env.ORDO_PUBLIC_WEB_BASE_URL || "").trim();
  const issueUrl = buildIssueDeepLink({
    publicBase,
    workspaceUrlSlug: workspaceRow?.url,
    issuesId: issueRow.issuesId
  });
  return {
    userMap,
    cycleName: cycleRow?.name || null,
    projectKey: proj?.key || null,
    issueUrl
  };
}

issuesRouter.post("/", async (req, res) => {
  const body = req.body ?? {};
  const {
    projectId: bodyProjectId,
    parentIssueId: parentIssueIdRaw,
    teamId: bodyTeamId = null,
    title,
    description,
    cycleId: bodyCycleId = null,
    status = "todo",
    priority: priorityRaw = 0,
    type = "feature",
    estimateHours = null,
    assigneeId = null,
    labels = [],
    dueDate = null
  } = body;

  let projectId = bodyProjectId;
  let teamId = bodyTeamId;
  let resolvedCycleId = bodyCycleId || null;
  let parentIssueIdForCreate = null;

  const rawTitle = String(title ?? "").trim();
  if (!rawTitle) {
    return res.status(400).json({ message: "title is required" });
  }

  if (parentIssueIdRaw != null && parentIssueIdRaw !== "") {
    const parent = await findIssueByRouteParam(String(parentIssueIdRaw), req.context);
    if (!parent) {
      return res.status(400).json({ message: "parent issue not found" });
    }
    if (parent.parentIssueId) {
      return res.status(422).json({ message: "cannot create subtask of a subtask" });
    }
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: parent.workspaceId, userId: req.context.userId }
    });
    if (!member) {
      return res.status(403).json({ message: "Forbidden" });
    }
    projectId = parent.projectId;
    teamId = parent.teamId;
    resolvedCycleId = parent.cycleId;
    parentIssueIdForCreate = parent.id;
  }

  // 仅标题必填：未传 projectId 时自动选一个可用项目（无项目则创建默认项目）
  if (!projectId) {
    const wid = req.context.workspaceId;
    if (!wid) {
      return res.status(400).json({ message: "workspaceId is required" });
    }
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: wid, userId: req.context.userId }
    });
    if (!member) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const pick = await prisma.project.findFirst({
      where: { workspaceId: wid, organizationId: req.context.organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });
    if (pick) {
      projectId = pick.id;
    } else {
      // 兜底：创建默认项目（key 唯一）
      const baseName = "默认项目";
      const baseKey = "DEF";
      let nameTry = baseName;
      let keyTry = baseKey;
      let n = 2;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const clash = await prisma.project.findFirst({
          where: { workspaceId: wid, OR: [{ name: { equals: nameTry, mode: "insensitive" } }, { key: keyTry }] },
          select: { id: true }
        });
        if (!clash) {
          break;
        }
        nameTry = `${baseName}${n}`;
        keyTry = `${baseKey}${n}`;
        n += 1;
      }
      const created = await prisma.project.create({
        data: {
          workspaceId: wid,
          organizationId: req.context.organizationId,
          name: nameTry,
          key: keyTry
        },
        select: { id: true }
      });
      projectId = created.id;
    }
  }
  if (!["feature", "bug", "chore"].includes(type)) {
    return res.status(422).json({ message: "invalid type" });
  }
  const priority = Math.round(Number(priorityRaw));
  if (!Number.isFinite(priority) || !Number.isInteger(priority) || priority < 0 || priority > 4) {
    return res.status(422).json({ message: "invalid priority" });
  }
  if (!["todo", "in_progress", "in_review", "done"].includes(status)) {
    return res.status(422).json({ message: "invalid status" });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, workspaceId: true, organizationId: true, key: true }
  });
  if (!project) {
    return res.status(400).json({ message: "project not found" });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: project.workspaceId, userId: req.context.userId }
  });
  if (!member) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const workspaceId = project.workspaceId;
  const organizationId = project.organizationId;

  let team = null;
  if (teamId) {
    team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
    if (!team) {
      return res.status(400).json({ message: "Invalid teamId for workspace" });
    }
  }

  if (resolvedCycleId) {
    const rowC = await prisma.cycle.findFirst({ where: { id: resolvedCycleId, workspaceId } });
    if (!rowC) {
      return res.status(400).json({ message: "invalid cycleId for workspace" });
    }
  }

  const identifier = String(team?.identifier || project.key || "")
    .trim()
    .toUpperCase();

  const scopeKey = identifier ? `identifier:${identifier}` : `project:${projectId}`;
  const labelsArr = Array.isArray(labels) ? labels : [];
  const due = dueDate ? new Date(dueDate) : null;
  const desc = description ?? null;
  /** 与 Issue.issuesId 一致：前缀大写且无空白；缺 team key / project.key 时用 X（见 buildIssuesId） */
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
        parentIssueId: parentIssueIdForCreate,
        cycleId: resolvedCycleId,
        title: rawTitle,
        description: desc,
        status,
        priority,
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
    await appendActivity(tx, row.id, "issue_created", req.context.userId, {
      title: row.title,
      projectId: row.projectId
    });
    return row;
  });

  const pName = project?.key ? `${project.key}` : null;
  void (async () => {
    const ctx = await loadIssueDingTalkSideContext(created, [
      req.context.userId,
      created.assigneeId
    ]);
    const actorRow = ctx.userMap.get(req.context.userId);
    const assigneeRow = created.assigneeId ? ctx.userMap.get(created.assigneeId) : null;
    const { text, atMobiles, atUserIds } = formatIssueNotify({
      action: "created",
      issuesId: created.issuesId,
      issueType: created.type,
      title: created.title,
      status: created.status,
      projectName: pName,
      actor: actorRow
        ? { name: actorRow.name, dingTalkUnionId: actorRow.dingTalkUnionId }
        : null,
      assignee: assigneeRow
        ? {
            name: assigneeRow.name,
            dingTalkMobile: assigneeRow.dingTalkMobile,
            dingTalkUserId: assigneeRow.dingTalkUserId,
            dingTalkStaffId: assigneeRow.dingTalkStaffId
          }
        : null,
      estimateHours: created.estimateHours,
      dueDate: created.dueDate,
      cycleName: ctx.cycleName,
      projectKey: pName,
      issueUrl: ctx.issueUrl
    });
    await notifyTeamsDingTalk({
      workspaceId: created.workspaceId,
      teamId: created.teamId,
      text,
      atMobiles,
      atUserIds
    });
  })().catch((e) => {
    console.warn("[notify:dingtalk] issue created send failed", e?.message || e);
  });
  invalidateWorkspace(created.workspaceId);

  return res.status(201).json(mapIssueToApi(created));
});

issuesRouter.get("/:id/comments", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const comments = await prisma.issueComment.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: "asc" }
  });
  return res.json({
    items: comments.map((c) => ({
      id: c.id,
      issueId: c.issueId,
      body: c.body,
      userId: c.userId,
      createdAt: c.createdAt.toISOString()
    }))
  });
});

issuesRouter.post("/:id/comments", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const body = req.body?.body;
  if (!body) {
    return res.status(400).json({ message: "body is required" });
  }

  const row = await prisma.$transaction(async (tx) => {
    const comment = await tx.issueComment.create({
      data: {
        organizationId: issue.organizationId,
        issueId: issue.id,
        body,
        userId: req.context.userId
      }
    });
    await tx.issue.update({
      where: { id: issue.id },
      data: { updatedAt: new Date() }
    });
    await appendActivity(tx, issue.id, "comment_created", req.context.userId, { commentId: comment.id });
    return comment;
  });
  invalidateWorkspace(issue.workspaceId);

  void (async () => {
    const ctx = await loadIssueDingTalkSideContext(issue, [req.context.userId, issue.assigneeId].filter(Boolean));
    const commenterRow = ctx.userMap.get(req.context.userId);
    const assigneeRow = issue.assigneeId ? ctx.userMap.get(issue.assigneeId) : null;
    const { text, atMobiles, atUserIds } = formatIssueNotify({
      action: "commented",
      issuesId: issue.issuesId,
      issueType: issue.type,
      title: issue.title,
      commentBody: row.body,
      commenter: commenterRow ? { name: commenterRow.name } : null,
      assignee: assigneeRow
        ? {
            name: assigneeRow.name,
            dingTalkMobile: assigneeRow.dingTalkMobile,
            dingTalkUserId: assigneeRow.dingTalkUserId,
            dingTalkStaffId: assigneeRow.dingTalkStaffId
          }
        : null,
      issueUrl: ctx.issueUrl
    });
    await notifyTeamsDingTalk({
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      text,
      atMobiles,
      atUserIds
    });
  })().catch((e) => {
    console.warn("[notify:dingtalk] issue comment send failed", e?.message || e);
  });

  return res.status(201).json({
    id: row.id,
    issueId: row.issueId,
    body: row.body,
    userId: row.userId,
    createdAt: row.createdAt.toISOString()
  });
});

issuesRouter.post("/:id/attachments", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const dataBase64 = req.body?.dataBase64;
  if (typeof dataBase64 !== "string" || !dataBase64.trim()) {
    return res.status(400).json({ message: "dataBase64 is required" });
  }
  const fileName = sanitizeAttachmentFileName(req.body?.fileName);
  let contentType = normalizeStringOrNull(req.body?.contentType);
  if (!contentType) {
    contentType = "application/octet-stream";
  }
  let buffer;
  try {
    buffer = Buffer.from(String(dataBase64).replace(/\s/g, ""), "base64");
  } catch {
    return res.status(400).json({ message: "invalid base64" });
  }
  if (!buffer.length) {
    return res.status(400).json({ message: "empty file" });
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return res.status(413).json({ message: `file too large (max ${MAX_ATTACHMENT_BYTES} bytes)` });
  }

  const row = await prisma.$transaction(async (tx) => {
    const att = await tx.issueAttachment.create({
      data: {
        organizationId: issue.organizationId,
        issueId: issue.id,
        fileName,
        contentType,
        size: buffer.length,
        blob: buffer,
        uploadedById: req.context.userId
      }
    });
    await tx.issue.update({
      where: { id: issue.id },
      data: { updatedAt: new Date() }
    });
    await appendActivity(tx, issue.id, "attachment_created", req.context.userId, {
      attachmentId: att.id,
      fileName: att.fileName
    });
    return att;
  });
  invalidateWorkspace(issue.workspaceId);

  return res.status(201).json({
    id: row.id,
    issueId: row.issueId,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt.toISOString()
  });
});

issuesRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const att = await prisma.issueAttachment.findFirst({
    where: { id: req.params.attachmentId, issueId: issue.id }
  });
  if (!att) {
    return res.status(404).json({ message: "Attachment not found" });
  }
  const buf = Buffer.from(att.blob);
  const asciiName = String(att.fileName)
    .replace(/"/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 200);
  res.setHeader("Content-Type", att.contentType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(att.fileName)}`
  );
  res.setHeader("Content-Length", String(buf.length));
  return res.send(buf);
});

issuesRouter.delete("/:id/attachments/:attachmentId", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const att = await prisma.issueAttachment.findFirst({
    where: { id: req.params.attachmentId, issueId: issue.id }
  });
  if (!att) {
    return res.status(404).json({ message: "Attachment not found" });
  }
  await prisma.$transaction(async (tx) => {
    await tx.issueAttachment.delete({ where: { id: att.id } });
    await tx.issue.update({
      where: { id: issue.id },
      data: { updatedAt: new Date() }
    });
    await appendActivity(tx, issue.id, "attachment_deleted", req.context.userId, {
      attachmentId: att.id,
      fileName: att.fileName
    });
  });
  invalidateWorkspace(issue.workspaceId);
  return res.status(204).send();
});

issuesRouter.get("/:id/activity", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const rows = await prisma.issueActivity.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: "asc" }
  });
  return res.json({
    items: rows.map((a) => ({
      id: a.id,
      type: a.type,
      userId: a.userId,
      payload: a.payload && typeof a.payload === "object" ? a.payload : {},
      createdAt: a.createdAt.toISOString()
    }))
  });
});

issuesRouter.get("/:id", async (req, res) => {
  const slim = await findIssueByRouteParam(req.params.id, req.context);
  if (!slim) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const issue = await prisma.issue.findUnique({
    where: { id: slim.id },
    include: issueDetailInclude
  });
  return res.json(
    mapIssueToApi(issue, {
      includeComments: true,
      includeActivity: true,
      includeSubtasks: true,
      includeParent: true,
      includeAttachments: true
    })
  );
});

issuesRouter.patch("/:id", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }

  const allowedKeys = [
    "title",
    "description",
    "status",
    "priority",
    "type",
    "estimateHours",
    "assigneeId",
    "labels",
    "dueDate",
    "projectId",
    "cycleId",
    "teamId"
  ];
  const changes = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      changes[key] = req.body[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "cycleId")) {
    if (changes.cycleId == null || changes.cycleId === "") {
      changes.cycleId = null;
    } else {
      const rowC = await prisma.cycle.findFirst({
        where: { id: changes.cycleId, workspaceId: req.context.workspaceId }
      });
      if (!rowC) {
        return res.status(422).json({ message: "invalid cycleId" });
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "type")) {
    if (!["feature", "bug", "chore"].includes(changes.type)) {
      return res.status(422).json({ message: "invalid type" });
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    if (!Number.isInteger(changes.priority) || changes.priority < 0 || changes.priority > 4) {
      return res.status(422).json({ message: "invalid priority" });
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "labels")) {
    if (!Array.isArray(changes.labels)) {
      return res.status(422).json({ message: "labels must be array" });
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "projectId")) {
    const p = await prisma.project.findFirst({
      where: { id: changes.projectId, workspaceId: req.context.workspaceId }
    });
    if (!p) {
      return res.status(422).json({ message: "invalid projectId" });
    }
  }

  // 只在“真实变化”时写库并记录动态
  const data = {};
  /** @type {Record<string, {from: unknown, to: unknown}>} */
  const changeDetail = {};

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const next = normalizeStringOrNull(changes.title);
    const prev = issue.title ?? null;
    if (!eqScalar(prev, next)) {
      data.title = next;
      changeDetail.title = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "description")) {
    const next = normalizeStringOrNull(changes.description);
    const prev = issue.description ?? null;
    if (!eqScalar(prev, next)) {
      data.description = next;
      changeDetail.description = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    const next = changes.status;
    const prev = issue.status;
    if (!eqScalar(prev, next)) {
      data.status = next;
      changeDetail.status = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    const next = changes.priority;
    const prev = issue.priority;
    if (!eqScalar(prev, next)) {
      data.priority = next;
      changeDetail.priority = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "type")) {
    const next = changes.type;
    const prev = issue.type;
    if (!eqScalar(prev, next)) {
      data.type = next;
      changeDetail.type = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "estimateHours")) {
    const next = normalizeNumberOrNull(changes.estimateHours);
    const prev = issue.estimateHours == null ? null : Number(issue.estimateHours);
    if (!eqScalar(prev, next)) {
      data.estimateHours = next;
      changeDetail.estimateHours = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "assigneeId")) {
    const next = normalizeStringOrNull(changes.assigneeId);
    const prev = issue.assigneeId ?? null;
    if (!eqScalar(prev, next)) {
      data.assigneeId = next;
      changeDetail.assigneeId = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "labels")) {
    const next = normalizeLabels(changes.labels);
    const prev = Array.isArray(issue.labels) ? issue.labels : [];
    if (next && !sameStringArray(prev, next)) {
      data.labels = next;
      changeDetail.labels = { from: prev, to: next };
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "dueDate")) {
    const next = normalizeDateOrNull(changes.dueDate);
    const prev = issue.dueDate ?? null;
    const prevIso = prev ? new Date(prev).toISOString() : null;
    const nextIso = next ? next.toISOString() : null;
    if (!eqStringish(prevIso, nextIso)) {
      data.dueDate = next;
      changeDetail.dueDate = { from: prevIso, to: nextIso };
    }
  }
  for (const k of ["projectId", "cycleId", "teamId"]) {
    if (Object.prototype.hasOwnProperty.call(changes, k)) {
      const next = normalizeStringOrNull(changes[k]);
      const prev = issue[k] ?? null;
      if (!eqScalar(prev, next)) {
        data[k] = next;
        changeDetail[k] = { from: prev, to: next };
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return res.json(mapIssueToApi(issue));
  }
  data.updatedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.issue.update({
      where: { id: issue.id },
      data
    });
    await appendActivity(tx, issue.id, "issue_updated", req.context.userId, { changes: changeDetail });
    return row;
  });

  const becameDone = updated.status === "done" && issue.status !== "done";
  if (becameDone) {
    void (async () => {
      const ctx = await loadIssueDingTalkSideContext(updated, [
        req.context.userId,
        updated.assigneeId
      ]);
      const actorRow = ctx.userMap.get(req.context.userId);
      const assigneeRow = updated.assigneeId ? ctx.userMap.get(updated.assigneeId) : null;
      const { text, atMobiles, atUserIds } = formatIssueNotify({
        action: "completed",
        issuesId: updated.issuesId,
        issueType: updated.type,
        title: updated.title,
        actor: actorRow ? { name: actorRow.name, dingTalkUnionId: actorRow.dingTalkUnionId } : null,
        assignee: assigneeRow
          ? {
              name: assigneeRow.name,
              dingTalkMobile: assigneeRow.dingTalkMobile,
              dingTalkUserId: assigneeRow.dingTalkUserId,
              dingTalkStaffId: assigneeRow.dingTalkStaffId
            }
          : null,
        cycleName: ctx.cycleName,
        projectKey: ctx.projectKey,
        issueUrl: ctx.issueUrl
      });
      await notifyTeamsDingTalk({
        workspaceId: updated.workspaceId,
        teamId: updated.teamId,
        text,
        atMobiles,
        atUserIds
      });
    })().catch((e) => {
      console.warn("[notify:dingtalk] issue completed send failed", e?.message || e);
    });
  }
  invalidateWorkspace(updated.workspaceId);

  return res.json(mapIssueToApi(updated));
});

issuesRouter.delete("/:id", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  const snap = await prisma.issue.findUnique({
    where: { id: issue.id },
    select: {
      workspaceId: true,
      teamId: true,
      issuesId: true,
      title: true,
      status: true,
      projectId: true,
      assigneeId: true
    }
  });
  await prisma.issue.delete({ where: { id: issue.id } });
  if (snap?.workspaceId) {
    invalidateWorkspace(snap.workspaceId);
  }
  return res.json({ id: issue.id, deleted: true });
});

module.exports = { issuesRouter };
