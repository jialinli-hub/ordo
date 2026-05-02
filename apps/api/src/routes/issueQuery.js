const express = require("express");
const { queryIssues, boardIssuesByStatus } = require("../services/issueQueryService");

const issueQueryRouter = express.Router();

issueQueryRouter.get("/", async (req, res, next) => {
  try {
    const organizationId = req.context.organizationId;
    const workspaceId = req.context.workspaceId;
    const { status, page, pageSize, teamId } = req.query;
    const result = await queryIssues({ organizationId, workspaceId, status, teamId, page, pageSize });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

issueQueryRouter.get("/board", async (req, res, next) => {
  try {
    const organizationId = req.context.organizationId;
    const workspaceId = req.context.workspaceId;
    const grouped = await boardIssuesByStatus(organizationId, workspaceId);
    return res.json(grouped);
  } catch (e) {
    return next(e);
  }
});

module.exports = { issueQueryRouter };
