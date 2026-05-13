const express = require("express");
const { prisma } = require("../repositories/prisma");
const { invalidateWorkspace } = require("../services/workspaceReadCache");

const requirementsRouter = express.Router();

const REQUIREMENT_STATUSES = new Set(["draft", "triaging", "ready", "converted"]);
const MAX_OTHER_FILES = 30;
const MAX_PURPOSE_LEN = 200;
const MAX_URL_LEN = 2048;

function normalizePrdUrl(v) {
  if (v == null || v === "") {
    return null;
  }
  const t = String(v).trim();
  return t === "" ? null : t.slice(0, MAX_URL_LEN);
}

function mapOtherFilesFromJson(json) {
  if (!Array.isArray(json)) {
    return [];
  }
  return json
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      purpose: String(x.purpose ?? "").slice(0, MAX_PURPOSE_LEN),
      url: String(x.url ?? "").slice(0, MAX_URL_LEN)
    }))
    .filter((x) => x.url.trim() !== "");
}

function normalizeOtherFilesForWrite(input) {
  if (!Array.isArray(input)) {
    return null;
  }
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    if (out.length >= MAX_OTHER_FILES) {
      break;
    }
    const url = String(raw.url ?? "")
      .trim()
      .slice(0, MAX_URL_LEN);
    if (url === "") {
      continue;
    }
    let purpose = String(raw.purpose ?? "")
      .trim()
      .slice(0, MAX_PURPOSE_LEN);
    if (purpose === "") {
      purpose = "其他文件";
    }
    out.push({ purpose, url });
  }
  return out.length ? out : null;
}

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

function mapRequirement(row) {
  return {
    id: row.id,
    title: row.title,
    prd: row.prd ?? "",
    prdUrl: row.prdUrl ?? null,
    otherFiles: mapOtherFilesFromJson(row.otherFilesJson),
    status: row.status,
    createdById: row.createdById,
    convertedProjectId: row.convertedProjectId ?? null,
    convertedCycleId: row.convertedCycleId ?? null,
    convertedTeamId: row.convertedTeamId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

requirementsRouter.use((req, res, next) => {
  if (!req.context?.workspaceId) {
    return res.status(400).json({ message: "缺少 Workspace 上下文，请登录并选择工作区" });
  }
  next();
});

requirementsRouter.get("/", async (req, res) => {
  const { workspaceId } = req.context;
  const statusQ = req.query.status != null ? String(req.query.status).trim() : "";
  const where = { workspaceId };
  if (statusQ && REQUIREMENT_STATUSES.has(statusQ)) {
    where.status = statusQ;
  }
  const rows = await prisma.requirement.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  return res.json({ items: rows.map(mapRequirement) });
});

requirementsRouter.get("/:id", async (req, res) => {
  const { workspaceId } = req.context;
  const row = await prisma.requirement.findFirst({
    where: { id: req.params.id, workspaceId }
  });
  if (!row) {
    return res.status(404).json({ message: "Requirement not found" });
  }
  return res.json(mapRequirement(row));
});

requirementsRouter.post("/", async (req, res) => {
  const { organizationId, workspaceId, userId } = req.context;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    return res.status(400).json({ message: "title is required" });
  }
  const prd = typeof req.body?.prd === "string" ? req.body.prd : "";
  const statusRaw = req.body?.status != null ? String(req.body.status).trim() : "draft";
  const status = REQUIREMENT_STATUSES.has(statusRaw) ? statusRaw : "draft";
  if (status === "converted") {
    return res.status(422).json({ message: "cannot create requirement with status converted" });
  }

  let prdUrlVal;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "prdUrl")) {
    prdUrlVal = normalizePrdUrl(req.body.prdUrl);
  }

  let otherFilesJsonVal;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "otherFiles")) {
    if (!Array.isArray(req.body.otherFiles)) {
      return res.status(422).json({ message: "otherFiles must be an array" });
    }
    otherFilesJsonVal = normalizeOtherFilesForWrite(req.body.otherFiles);
  }

  const row = await prisma.requirement.create({
    data: {
      organizationId,
      workspaceId,
      title,
      prd,
      status,
      createdById: userId,
      ...(prdUrlVal !== undefined ? { prdUrl: prdUrlVal } : {}),
      ...(otherFilesJsonVal !== undefined ? { otherFilesJson: otherFilesJsonVal } : {})
    }
  });
  invalidateWorkspace(workspaceId);
  return res.status(201).json(mapRequirement(row));
});

requirementsRouter.patch("/:id", async (req, res) => {
  const { workspaceId } = req.context;
  const existing = await prisma.requirement.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!existing) {
    return res.status(404).json({ message: "Requirement not found" });
  }

  /** @type {Record<string, unknown>} */
  const data = {};
  if (typeof req.body?.title === "string") {
    const t = req.body.title.trim();
    if (!t) {
      return res.status(400).json({ message: "title cannot be empty" });
    }
    data.title = t;
  }
  if (typeof req.body?.prd === "string") {
    data.prd = req.body.prd;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "prdUrl")) {
    data.prdUrl = normalizePrdUrl(req.body.prdUrl);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "otherFiles")) {
    if (!Array.isArray(req.body.otherFiles)) {
      return res.status(422).json({ message: "otherFiles must be an array" });
    }
    data.otherFilesJson = normalizeOtherFilesForWrite(req.body.otherFiles);
  }
  if (req.body?.status != null) {
    const s = String(req.body.status).trim();
    if (!REQUIREMENT_STATUSES.has(s)) {
      return res.status(422).json({ message: "invalid status" });
    }
    if (s === "converted") {
      return res.status(422).json({ message: "use POST /:id/convert to set converted" });
    }
    data.status = s;
    if (existing.status === "converted" && s !== "converted") {
      data.convertedProjectId = null;
      data.convertedCycleId = null;
      data.convertedTeamId = null;
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "no changes" });
  }

  const row = await prisma.requirement.update({
    where: { id: existing.id },
    data
  });
  invalidateWorkspace(workspaceId);
  return res.json(mapRequirement(row));
});

requirementsRouter.delete("/:id", async (req, res) => {
  const { workspaceId } = req.context;
  const existing = await prisma.requirement.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!existing) {
    return res.status(404).json({ message: "Requirement not found" });
  }
  await prisma.requirement.delete({ where: { id: existing.id } });
  invalidateWorkspace(workspaceId);
  return res.status(204).send();
});

requirementsRouter.post("/:id/convert", async (req, res) => {
  const { organizationId, workspaceId } = req.context;
  const { teamId, cycleName, startsAt, endsAt } = req.body ?? {};

  const existing = await prisma.requirement.findFirst({
    where: { id: req.params.id, workspaceId }
  });
  if (!existing) {
    return res.status(404).json({ message: "Requirement not found" });
  }
  if (existing.status === "converted") {
    return res.status(409).json({ message: "requirement already converted" });
  }

  if (!teamId || String(teamId).trim() === "") {
    return res.status(400).json({ message: "teamId is required" });
  }
  const team = await prisma.team.findFirst({ where: { id: String(teamId).trim(), workspaceId } });
  if (!team) {
    return res.status(422).json({ message: "invalid teamId" });
  }

  if (!cycleName || !String(cycleName).trim()) {
    return res.status(400).json({ message: "cycleName is required" });
  }
  if (!startsAt || !endsAt) {
    return res.status(400).json({ message: "startsAt and endsAt are required" });
  }
  if (new Date(startsAt) > new Date(endsAt)) {
    return res.status(422).json({ message: "startsAt must be before or equal to endsAt" });
  }

  const productDocFromPrd = normalizePrdUrl(existing.prdUrl);

  const result = await prisma.$transaction(async (tx) => {
    const cycleRow = await tx.cycle.create({
      data: {
        organizationId,
        workspaceId,
        teamId: team.id,
        projectId: null,
        name: String(cycleName).trim(),
        kind: "project",
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        status: computeCycleStatus(startsAt, endsAt),
        ...(productDocFromPrd != null ? { productDocUrl: productDocFromPrd } : {})
      }
    });

    await tx.requirement.update({
      where: { id: existing.id },
      data: {
        status: "converted",
        convertedProjectId: null,
        convertedCycleId: cycleRow.id,
        convertedTeamId: team.id
      }
    });

    return { cycle: cycleRow };
  });

  invalidateWorkspace(workspaceId);

  const cycle = result.cycle;
  const reqOut = await prisma.requirement.findFirst({
    where: { id: existing.id, workspaceId }
  });
  return res.status(201).json({
    requirement: mapRequirement(reqOut),
    cycle: {
      id: cycle.id,
      workspaceId: cycle.workspaceId,
      teamId: cycle.teamId,
      projectId: cycle.projectId,
      name: cycle.name,
      kind: cycle.kind,
      productDocUrl: cycle.productDocUrl ?? null,
      startsAt: cycle.startsAt.toISOString(),
      endsAt: cycle.endsAt.toISOString(),
      status: cycle.status,
      createdAt: cycle.createdAt.toISOString(),
      updatedAt: cycle.updatedAt.toISOString()
    }
  });
});

module.exports = { requirementsRouter };
