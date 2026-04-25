const express = require("express");
const { queryIssues, boardIssuesByStatus } = require("../services/issueQueryService");

const issueQueryRouter = express.Router();

issueQueryRouter.get("/", (req, res) => {
  const organizationId = req.context.organizationId;
  const { status, page, pageSize } = req.query;
  const result = queryIssues({ organizationId, status, page, pageSize });
  return res.json(result);
});

issueQueryRouter.get("/board", (req, res) => {
  const organizationId = req.context.organizationId;
  const grouped = boardIssuesByStatus(organizationId);
  return res.json(grouped);
});

module.exports = { issueQueryRouter };
