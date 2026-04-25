const express = require("express");
const { store } = require("../repositories/memoryStore");
const { transitionIssueStatus } = require("../domain/issueStateMachine");

const issueTransitionsRouter = express.Router();

issueTransitionsRouter.patch("/:id/status", (req, res) => {
  const issue = store.issues.find((item) => item.id === req.params.id);
  if (!issue) {
    return res.status(404).json({ message: "Issue not found" });
  }

  const nextStatus = req.body?.status;
  if (!nextStatus) {
    return res.status(400).json({ message: "status is required" });
  }

  try {
    issue.status = transitionIssueStatus(issue.status, nextStatus);
    return res.json(issue);
  } catch {
    return res.status(400).json({ message: "Invalid status transition" });
  }
});

module.exports = { issueTransitionsRouter };
