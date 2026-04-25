const express = require("express");
const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");

const workspacesRouter = express.Router();

workspacesRouter.get("/", (_req, res) => {
  return res.json({ items: store.workspaces });
});

workspacesRouter.post("/", (req, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const workspace = {
    id: randomUUID(),
    name,
    ownerUserId: req.context.userId || "anonymous"
  };
  store.workspaces.push(workspace);
  return res.status(201).json(workspace);
});

module.exports = { workspacesRouter };
