const express = require("express");
const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");

const cyclesRouter = express.Router();

cyclesRouter.post("/", (req, res) => {
  const organizationId = req.context.organizationId;
  const { projectId, name, startsAt, endsAt } = req.body ?? {};
  if (!projectId || !name || !startsAt || !endsAt) {
    return res.status(400).json({ message: "projectId, name, startsAt, endsAt are required" });
  }

  const cycle = {
    id: randomUUID(),
    organizationId,
    projectId,
    name,
    startsAt,
    endsAt,
    status: "active",
    createdAt: new Date().toISOString()
  };
  store.cycles.push(cycle);
  return res.status(201).json(cycle);
});

cyclesRouter.get("/", (req, res) => {
  const organizationId = req.context.organizationId;
  const items = store.cycles.filter((cycle) => cycle.organizationId === organizationId);
  return res.json({ items });
});

module.exports = { cyclesRouter };
