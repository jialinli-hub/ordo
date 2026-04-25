const express = require("express");
const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");
const { getNextIssueNumber } = require("../services/issueNumberService");

const issuesRouter = express.Router();

issuesRouter.post("/", (req, res) => {
  const organizationId = req.context.organizationId;
  const { projectId, title, description } = req.body ?? {};

  if (!projectId || !title) {
    return res.status(400).json({ message: "projectId and title are required" });
  }

  const issue = {
    id: randomUUID(),
    organizationId,
    projectId,
    title,
    description: description ?? null,
    status: "todo",
    priority: 0,
    issueNumber: getNextIssueNumber(projectId),
    createdAt: new Date().toISOString()
  };

  store.issues.push(issue);
  return res.status(201).json(issue);
});

module.exports = { issuesRouter };
