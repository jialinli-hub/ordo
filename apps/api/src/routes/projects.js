const express = require("express");
const {
  createProject,
  listProjectsByOrganization
} = require("../repositories/projectRepository");

const projectsRouter = express.Router();

projectsRouter.post("/", (req, res) => {
  const organizationId = req.context.organizationId;
  const { name, key } = req.body ?? {};

  if (!name || !key) {
    return res.status(400).json({ message: "name and key are required" });
  }

  const project = createProject({ organizationId, name, key });
  return res.status(201).json(project);
});

projectsRouter.get("/", (req, res) => {
  const organizationId = req.context.organizationId;
  const projects = listProjectsByOrganization(organizationId);
  return res.json({ items: projects });
});

module.exports = { projectsRouter };
