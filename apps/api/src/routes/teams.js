const express = require("express");
const { prisma } = require("../repositories/prisma");

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

function pickRandomTeamAccentColor() {
  return TEAM_ACCENT_COLORS[Math.floor(Math.random() * TEAM_ACCENT_COLORS.length)];
}

function mapTeamRow(team) {
  const labelsRaw = team.issueLabelsJson;
  const statusesRaw = team.issueStatusesJson;
  return {
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    identifier: team.identifier,
    accentColor: team.accentColor,
    iterationDurationDays: team.iterationDurationDays ?? 14,
    cooldownDays: team.cooldownDays ?? 2,
    iterationStartWeekday: team.iterationStartWeekday ?? 1,
    issueLabels: Array.isArray(labelsRaw) ? labelsRaw : DEFAULT_LABELS,
    issueStatuses: Array.isArray(statusesRaw) ? statusesRaw : DEFAULT_STATUSES
  };
}

const teamsRouter = express.Router();

function resolveWorkspaceId(req) {
  const q = req.query.workspaceId;
  if (q != null && String(q).trim() !== "") {
    return String(q).trim();
  }
  const ctx = req.context.workspaceId;
  if (ctx == null || ctx === "") {
    return null;
  }
  const s = String(ctx).trim();
  if (/^org-/i.test(s)) {
    return null;
  }
  return s;
}

async function hasMembership(workspaceId, userId) {
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  return Boolean(m);
}

teamsRouter.get("/", async (req, res) => {
  const workspaceId = resolveWorkspaceId(req);
  if (!workspaceId) {
    return res.status(400).json({ message: "workspaceId is required" });
  }
  if (!(await hasMembership(workspaceId, req.context.userId))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const rows = await prisma.team.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  return res.json({ items: rows.map(mapTeamRow) });
});

teamsRouter.post("/", async (req, res) => {
  const bodyWid = req.body?.workspaceId != null ? String(req.body.workspaceId).trim() : "";
  const workspaceId = bodyWid || resolveWorkspaceId(req);
  if (!workspaceId) {
    return res.status(400).json({ message: "workspaceId is required" });
  }
  const { name, identifier } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ message: "workspaceId and name are required" });
  }
  const normalizedIdentifier = String(identifier || "")
    .trim()
    .toUpperCase();
  if (normalizedIdentifier && !/^[A-Z][A-Z0-9_-]*$/.test(normalizedIdentifier)) {
    return res.status(422).json({ message: "invalid team identifier" });
  }

  if (!(await hasMembership(workspaceId, req.context.userId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const teamNames = await prisma.team.findMany({ where: { workspaceId }, select: { name: true } });
  if (teamNames.some((t) => t.name.toLowerCase() === String(name).toLowerCase())) {
    return res.status(409).json({ message: "team name already exists" });
  }

  if (normalizedIdentifier) {
    const rows = await prisma.team.findMany({ where: { workspaceId, identifier: { not: null } } });
    const clash = rows.some((t) => String(t.identifier || "").toUpperCase() === normalizedIdentifier);
    if (clash) {
      return res.status(409).json({ message: "team identifier already exists" });
    }
  }

  const team = await prisma.team.create({
    data: {
      workspaceId,
      name,
      identifier: normalizedIdentifier || null,
      accentColor: pickRandomTeamAccentColor(),
      iterationDurationDays: 14,
      cooldownDays: 2,
      iterationStartWeekday: 1,
      issueLabelsJson: DEFAULT_LABELS,
      issueStatusesJson: DEFAULT_STATUSES
    }
  });
  return res.status(201).json(mapTeamRow(team));
});

teamsRouter.get("/:teamId", async (req, res) => {
  const workspaceId = resolveWorkspaceId(req);
  if (!workspaceId) {
    return res.status(400).json({ message: "workspaceId is required" });
  }
  const { teamId } = req.params;
  if (!(await hasMembership(workspaceId, req.context.userId))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
  if (!team) {
    return res.status(404).json({ message: "team not found" });
  }
  return res.json(mapTeamRow(team));
});

teamsRouter.patch("/:teamId", async (req, res) => {
  const workspaceId = resolveWorkspaceId(req);
  if (!workspaceId) {
    return res.status(400).json({ message: "workspaceId is required" });
  }
  const { teamId } = req.params;
  if (!(await hasMembership(workspaceId, req.context.userId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
  if (!team) {
    return res.status(404).json({ message: "team not found" });
  }

  const {
    name,
    identifier,
    accentColor,
    iterationDurationDays,
    cooldownDays,
    iterationStartWeekday,
    issueLabels,
    issueStatuses
  } = req.body ?? {};

  const data = {};

  if (name != null) {
    const next = String(name).trim();
    if (!next) {
      return res.status(400).json({ message: "invalid name" });
    }
    const clash = await prisma.team.findFirst({
      where: {
        workspaceId,
        id: { not: team.id },
        name: { equals: next, mode: "insensitive" }
      }
    });
    if (clash) {
      return res.status(409).json({ message: "team name already exists" });
    }
    data.name = next;
  }

  if (identifier !== undefined) {
    const normalizedIdentifier = String(identifier || "")
      .trim()
      .toUpperCase();
    if (normalizedIdentifier && !/^[A-Z][A-Z0-9_-]*$/.test(normalizedIdentifier)) {
      return res.status(422).json({ message: "invalid team identifier" });
    }
    if (normalizedIdentifier) {
      const rows = await prisma.team.findMany({
        where: { workspaceId, identifier: { not: null }, id: { not: team.id } }
      });
      if (rows.some((t) => String(t.identifier || "").toUpperCase() === normalizedIdentifier)) {
        return res.status(409).json({ message: "team identifier already exists" });
      }
    }
    data.identifier = normalizedIdentifier || null;
  }

  if (accentColor !== undefined) {
    data.accentColor = accentColor || null;
  }
  if (iterationDurationDays !== undefined) {
    const n = Number(iterationDurationDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return res.status(422).json({ message: "invalid iterationDurationDays" });
    }
    data.iterationDurationDays = Math.round(n);
  }
  if (cooldownDays !== undefined) {
    const n = Number(cooldownDays);
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      return res.status(422).json({ message: "invalid cooldownDays" });
    }
    data.cooldownDays = Math.round(n);
  }
  if (iterationStartWeekday !== undefined) {
    const n = Number(iterationStartWeekday);
    if (!Number.isFinite(n) || n < 0 || n > 6) {
      return res.status(422).json({ message: "invalid iterationStartWeekday" });
    }
    data.iterationStartWeekday = Math.round(n);
  }
  if (issueLabels !== undefined) {
    if (!Array.isArray(issueLabels)) {
      return res.status(422).json({ message: "issueLabels must be array" });
    }
    data.issueLabelsJson = issueLabels;
  }
  if (issueStatuses !== undefined) {
    if (!Array.isArray(issueStatuses)) {
      return res.status(422).json({ message: "issueStatuses must be array" });
    }
    data.issueStatusesJson = issueStatuses;
  }

  if (Object.keys(data).length === 0) {
    return res.json(mapTeamRow(team));
  }

  const updated = await prisma.team.update({ where: { id: team.id }, data });
  return res.json(mapTeamRow(updated));
});

teamsRouter.delete("/:teamId", async (req, res) => {
  const { teamId } = req.params;
  const workspaceId = resolveWorkspaceId(req);
  if (!workspaceId) {
    return res.status(400).json({ message: "workspaceId is required" });
  }
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: req.context.userId }
  });
  if (!membership) {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!["owner", "admin"].includes(membership.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
  if (!team) {
    return res.status(404).json({ message: "team not found" });
  }
  await prisma.team.delete({ where: { id: team.id } });
  return res.json({ id: team.id, deleted: true });
});

module.exports = { teamsRouter };
