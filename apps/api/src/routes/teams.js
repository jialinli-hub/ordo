const express = require("express");
const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");

const teamsRouter = express.Router();

teamsRouter.get("/", (req, res) => {
  const workspaceId = req.query.workspaceId || req.context.workspaceId;
  const items = store.teams.filter((team) => team.workspaceId === workspaceId);
  return res.json({ items });
});

teamsRouter.post("/", (req, res) => {
  const workspaceId = req.body?.workspaceId || req.context.workspaceId;
  const { name } = req.body ?? {};
  if (!workspaceId || !name) {
    return res.status(400).json({ message: "workspaceId and name are required" });
  }

  const team = {
    id: randomUUID(),
    workspaceId,
    name
  };
  store.teams.push(team);
  return res.status(201).json(team);
});

module.exports = { teamsRouter };
