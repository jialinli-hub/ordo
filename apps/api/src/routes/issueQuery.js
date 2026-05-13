const express = require("express");
const { prisma } = require("../repositories/prisma");
const { queryIssues, boardIssuesByStatus } = require("../services/issueQueryService");
const { buildIssueAccessWhere } = require("../services/issueWorkspaceScope");
const { makeKey, getJson, setJson } = require("../services/workspaceReadCache");

const issueQueryRouter = express.Router();

/**
 * 当前用户：待开始（todo）+ 进行中（in_progress），按创建时间升序取前 5 条；total 为同条件总数（角标）。
 */
issueQueryRouter.get("/my-pending-work", async (req, res, next) => {
  try {
    const organizationId = req.context.organizationId;
    const workspaceId = req.context.workspaceId;
    const userId = req.context.userId;
    if (!workspaceId || !userId) {
      return res.status(400).json({ message: "缺少 Workspace 或用户上下文" });
    }

    const baseWhere = buildIssueAccessWhere(organizationId, workspaceId);
    const where = {
      ...baseWhere,
      parentIssueId: null,
      assigneeId: userId,
      status: { in: ["todo", "in_progress"] }
    };

    const [rows, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          issuesId: true,
          title: true,
          status: true,
          createdAt: true
        }
      }),
      prisma.issue.count({ where })
    ]);

    return res.json({
      total,
      items: rows.map((r) => ({
        id: r.id,
        issues_id: r.issuesId,
        title: r.title,
        status: r.status,
        createdAt: r.createdAt.toISOString()
      }))
    });
  } catch (e) {
    return next(e);
  }
});

issueQueryRouter.get("/", async (req, res, next) => {
  try {
    const organizationId = req.context.organizationId;
    const workspaceId = req.context.workspaceId;
    const { status, page, pageSize, teamId } = req.query;
    const mineRaw = req.query.mine;
    const mine =
      mineRaw === "1" ||
      mineRaw === "true" ||
      String(mineRaw || "").toLowerCase() === "yes";
    const assigneeId = mine ? req.context.userId : undefined;
    const mineSeg = mine ? String(req.context.userId || "mine") : "";
    const cacheKey = makeKey([
      "v1",
      workspaceId,
      "issues",
      organizationId,
      status || "",
      teamId || "",
      mineSeg,
      String(page || ""),
      String(pageSize || "")
    ]);
    const hit = getJson(cacheKey);
    if (hit) {
      return res.json(hit);
    }
    const result = await queryIssues({
      organizationId,
      workspaceId,
      status,
      teamId,
      assigneeId,
      page,
      pageSize
    });
    setJson(cacheKey, result);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

issueQueryRouter.get("/board", async (req, res, next) => {
  try {
    const organizationId = req.context.organizationId;
    const workspaceId = req.context.workspaceId;
    const cacheKey = makeKey(["v1", workspaceId, "issues-board", organizationId]);
    const hit = getJson(cacheKey);
    if (hit) {
      return res.json(hit);
    }
    const grouped = await boardIssuesByStatus(organizationId, workspaceId);
    setJson(cacheKey, grouped);
    return res.json(grouped);
  } catch (e) {
    return next(e);
  }
});

module.exports = { issueQueryRouter };
