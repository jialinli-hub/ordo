const express = require("express");
const { prisma } = require("../repositories/prisma");

const organizationsRouter = express.Router();

organizationsRouter.post("/", async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const organization = await prisma.organization.create({
    data: { name }
  });

  return res.status(201).json({
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString()
  });
});

organizationsRouter.get("/", async (_req, res) => {
  const rows = await prisma.organization.findMany({ orderBy: { createdAt: "desc" } });
  return res.json({
    items: rows.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString()
    }))
  });
});

module.exports = { organizationsRouter };
