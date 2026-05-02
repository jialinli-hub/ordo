const express = require("express");
const { prisma } = require("../repositories/prisma");
const { bumpIssueNumberCounter } = require("../services/issueNumberService");
const { issueAllowedForWorkspaceContext } = require("../services/issueWorkspaceScope");
const { mapIssueToApi } = require("../utils/issueDto");
const { buildIssuesId } = require("../utils/issuesId");
const { findIssueByRouteParam } = require("../services/issueRouteLookup");

const issuesRouter = express.Router();

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

issuesRouter.post("/", async (req, res) => {
  const body = req.body ?? {};
  const {
    projectId: bodyProjectId,
    parentIssueId: parentIssueIdRaw,
    teamId: bodyTeamId = null,
    title,
    description,
    cycleId: bodyCycleId = null,
    cycleEpicId: bodyCycleEpicId = null,
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
  let resolvedEpicId = bodyCycleEpicId || null;
  let parentIssueIdForCreate = null;

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
    resolvedEpicId = parent.cycleEpicId;
    parentIssueIdForCreate = parent.id;
  }

  if (!projectId || !title) {
    return res.status(400).json({ message: "projectId and title are required" });
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

  if (resolvedEpicId) {
    const epic = await prisma.cycleEpic.findFirst({
      where: { id: resolvedEpicId, cycle: { workspaceId } }
    });
    if (!epic) {
      return res.status(400).json({ message: "invalid cycleEpicId" });
    }
    if (resolvedCycleId && resolvedCycleId !== epic.cycleId) {
      return res.status(422).json({ message: "cycleId must match the epic's cycle" });
    }
    resolvedCycleId = epic.cycleId;
    resolvedEpicId = epic.id;
  } else if (resolvedCycleId) {
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
        cycleEpicId: resolvedEpicId,
        title,
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

  return res.status(201).json({
    id: row.id,
    issueId: row.issueId,
    body: row.body,
    userId: row.userId,
    createdAt: row.createdAt.toISOString()
  });
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
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      activities: { orderBy: { createdAt: "asc" } },
      subtasks: { orderBy: { createdAt: "asc" } },
      parent: { select: { id: true, title: true, issuesId: true } }
    }
  });
  return res.json(
    mapIssueToApi(issue, {
      includeComments: true,
      includeActivity: true,
      includeSubtasks: true,
      includeParent: true
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
    "cycleEpicId",
    "teamId"
  ];
  const changes = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      changes[key] = req.body[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "cycleEpicId")) {
    const raw = changes.cycleEpicId;
    if (raw == null || raw === "") {
      changes.cycleEpicId = null;
    } else {
      const epic = await prisma.cycleEpic.findFirst({
        where: { id: raw, cycle: { workspaceId: req.context.workspaceId } }
      });
      if (!epic) {
        return res.status(422).json({ message: "invalid cycleEpicId" });
      }
      changes.cycleEpicId = epic.id;
      changes.cycleId = epic.cycleId;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "cycleId")) {
    if (changes.cycleId == null || changes.cycleId === "") {
      changes.cycleId = null;
      changes.cycleEpicId = null;
    } else {
      const rowC = await prisma.cycle.findFirst({
        where: { id: changes.cycleId, workspaceId: req.context.workspaceId }
      });
      if (!rowC) {
        return res.status(422).json({ message: "invalid cycleId" });
      }
      const epicId = Object.prototype.hasOwnProperty.call(changes, "cycleEpicId")
        ? changes.cycleEpicId
        : issue.cycleEpicId;
      if (epicId) {
        const epic = await prisma.cycleEpic.findUnique({ where: { id: epicId } });
        if (!epic || epic.cycleId !== changes.cycleId) {
          changes.cycleEpicId = null;
        }
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

  const data = { ...changes };
  if (Object.prototype.hasOwnProperty.call(data, "dueDate")) {
    data.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  }
  data.updatedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.issue.update({
      where: { id: issue.id },
      data
    });
    await appendActivity(tx, issue.id, "issue_updated", req.context.userId, { changes });
    return row;
  });

  return res.json(mapIssueToApi(updated));
});

issuesRouter.delete("/:id", async (req, res) => {
  const issue = await findIssueByRouteParam(req.params.id, req.context);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }
  await prisma.issue.delete({ where: { id: issue.id } });
  return res.json({ id: issue.id, deleted: true });
});

module.exports = { issuesRouter };
