const express = require("express");
const { prisma } = require("../repositories/prisma");

const issueViewPrefsRouter = express.Router();

/** 与 web `issuePrefs` 默认值保持一致 */
function defaultIssueViewPrefs() {
  return {
    viewMode: "list",
    listGroupBy: "status",
    orderBy: "priority",
    orderDesc: false,
    showEmptyBoardColumns: false,
    columns: {
      id: true,
      status: true,
      assignee: true,
      priority: true,
      project: true,
      cycle: true,
      estimate: true,
      labels: true,
      dueDate: true,
      created: false,
      updated: false
    }
  };
}

function mergePayload(stored) {
  const base = defaultIssueViewPrefs();
  if (!stored || typeof stored !== "object") {
    return base;
  }
  return {
    ...base,
    ...stored,
    columns: { ...base.columns, ...(stored.columns || {}) }
  };
}

function prefKeyForTeam(teamId) {
  return teamId ? `issueView:${teamId}` : "issueView:default";
}

issueViewPrefsRouter.get("/", async (req, res) => {
  const userId = req.context.userId;
  const workspaceId = req.context.workspaceId;
  const teamIdRaw = req.query.teamId != null ? String(req.query.teamId) : "";
  const teamId = teamIdRaw.trim() || "";

  if (!userId || !workspaceId) {
    return res.status(400).json({ message: "missing user or workspace context" });
  }

  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const prefKey = prefKeyForTeam(teamId);
  const row = await prisma.userPreference.findUnique({
    where: { userId_workspaceId_prefKey: { userId, workspaceId, prefKey } }
  });

  return res.json({ prefs: mergePayload(row?.payload ?? null) });
});

issueViewPrefsRouter.put("/", async (req, res) => {
  const userId = req.context.userId;
  const workspaceId = req.context.workspaceId;
  const teamIdRaw = req.query.teamId != null ? String(req.query.teamId) : "";
  const teamId = teamIdRaw.trim() || "";

  if (!userId || !workspaceId) {
    return res.status(400).json({ message: "missing user or workspace context" });
  }

  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const body = req.body;
  const mergedForResponse = mergePayload(body);
  const prefKey = prefKeyForTeam(teamId);

  await prisma.userPreference.upsert({
    where: { userId_workspaceId_prefKey: { userId, workspaceId, prefKey } },
    create: {
      userId,
      workspaceId,
      prefKey,
      payload: mergedForResponse
    },
    update: { payload: mergedForResponse }
  });

  return res.json({ prefs: mergedForResponse });
});

module.exports = { issueViewPrefsRouter };
