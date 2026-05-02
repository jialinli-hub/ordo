const express = require("express");

const {

  createProject,

  listProjectsByWorkspace,

  getProjectById,

  updateProject,

  deleteProject

} = require("../repositories/projectRepository");



const projectsRouter = express.Router();



function mapProject(p) {

  return {

    id: p.id,

    organizationId: p.organizationId,

    workspaceId: p.workspaceId,

    name: p.name,

    key: p.key,

    createdAt: p.createdAt.toISOString(),

    updatedAt: p.updatedAt.toISOString()

  };

}



projectsRouter.post("/", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const { name, key } = req.body ?? {};



  if (!name || !key) {

    return res.status(400).json({ message: "name and key are required" });

  }



  const list = await listProjectsByWorkspace(organizationId, workspaceId);

  if (list.some((project) => project.key === key)) {

    return res.status(409).json({ message: "project key already exists" });

  }



  const project = await createProject({ organizationId, workspaceId, name, key });

  return res.status(201).json(mapProject(project));

});



projectsRouter.get("/", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const projects = await listProjectsByWorkspace(organizationId, workspaceId);

  return res.json({ items: projects.map(mapProject) });

});



projectsRouter.get("/:id", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const project = await getProjectById(organizationId, workspaceId, req.params.id);

  if (!project) {

    return res.status(404).json({ message: "Project not found" });

  }

  return res.json(mapProject(project));

});



projectsRouter.patch("/:id", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const { name, key } = req.body ?? {};

  if (!name && !key) {

    return res.status(400).json({ message: "name or key is required" });

  }

  const list = await listProjectsByWorkspace(organizationId, workspaceId);

  if (

    key &&

    list.some((project) => project.id !== req.params.id && project.key === key)

  ) {

    return res.status(409).json({ message: "project key already exists" });

  }



  const project = await updateProject(organizationId, workspaceId, req.params.id, {

    ...(name ? { name } : {}),

    ...(key ? { key } : {})

  });

  if (!project) {

    return res.status(404).json({ message: "Project not found" });

  }

  return res.json(mapProject(project));

});



projectsRouter.delete("/:id", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const removed = await deleteProject(organizationId, workspaceId, req.params.id);

  if (!removed) {

    return res.status(404).json({ message: "Project not found" });

  }

  return res.json({ id: removed.id, deleted: true });

});



module.exports = { projectsRouter };

