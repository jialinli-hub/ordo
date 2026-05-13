const express = require("express");
const { prisma } = require("../repositories/prisma");

const searchQuickRouter = express.Router();

searchQuickRouter.get("/", async (req, res) => {
  const workspaceId = req.context.workspaceId;
  if (!workspaceId) {
    return res.status(400).json({ message: "缺少 Workspace 上下文" });
  }

  const raw = String(req.query.q ?? "").trim();
  if (raw.length < 1) {
    return res.json({ projects: [], issues: [] });
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "8"), 10) || 8, 1), 25);

  const [projectRows, issueRows] = await Promise.all([
    prisma.project.findMany({
      where: {
        workspaceId,
        OR: [
          { name: { contains: raw, mode: "insensitive" } },
          { key: { contains: raw, mode: "insensitive" } }
        ]
      },
      select: { id: true, name: true, key: true },
      take: limit,
      orderBy: { updatedAt: "desc" }
    }),
    prisma.issue.findMany({
      where: {
        workspaceId,
        OR: [
          { issuesId: { contains: raw, mode: "insensitive" } },
          { title: { contains: raw, mode: "insensitive" } }
        ]
      },
      select: { id: true, issuesId: true, title: true },
      take: limit,
      orderBy: { updatedAt: "desc" }
    })
  ]);

  return res.json({
    projects: projectRows.map((p) => ({ id: p.id, name: p.name, key: p.key })),
    issues: issueRows.map((i) => ({ id: i.id, issuesId: i.issuesId, title: i.title }))
  });
});

module.exports = { searchQuickRouter };
