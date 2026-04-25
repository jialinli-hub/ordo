const express = require("express");
const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");

const organizationsRouter = express.Router();

organizationsRouter.post("/", (req, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const organization = { id: randomUUID(), name };
  store.organizations.push(organization);
  return res.status(201).json(organization);
});

organizationsRouter.get("/", (_req, res) => {
  res.json({ items: store.organizations });
});

module.exports = { organizationsRouter };
