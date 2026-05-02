const express = require("express");
const { prisma } = require("../repositories/prisma");
const { transitionIssueStatus } = require("../domain/issueStateMachine");
const { mapIssueToApi } = require("../utils/issueDto");
const { findIssueByRouteParam } = require("../services/issueRouteLookup");

const issueTransitionsRouter = express.Router();

issueTransitionsRouter.patch("/:id/status", async (req, res) => {
  const row = await findIssueByRouteParam(req.params.id, req.context);
  if (!row) {
    return res.status(404).json({ message: "Issue not found" });
  }

  const nextStatus = req.body?.status;
  if (!nextStatus) {
    return res.status(400).json({ message: "status is required" });
  }

  try {
    const nextVal = transitionIssueStatus(row.status, nextStatus);
    const updated = await prisma.issue.update({
      where: { id: row.id },
      data: { status: nextVal, updatedAt: new Date() }
    });
    return res.json(mapIssueToApi(updated));
  } catch {
    return res.status(400).json({ message: "Invalid status transition" });
  }
});

module.exports = { issueTransitionsRouter };
