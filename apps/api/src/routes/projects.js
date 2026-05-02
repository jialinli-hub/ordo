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

    name: p.name,

    createdAt: p.createdAt.toISOString(),

    updatedAt: p.updatedAt.toISOString()

  };

}

/** 从名称生成 key 字母数字片段（全中文等无字母时为空，由调用方回退为 PRJ） */
function slugKeyFromName(name) {
  const raw = String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase();
  return raw.slice(0, 12);
}

function allocateAutoProjectKey(base, keySet) {
  const root = base && base.length > 0 ? base.slice(0, 12) : "PRJ";
  let candidate = root;
  let n = 0;
  while (keySet.has(candidate)) {
    n += 1;
    const suf = String(n);
    const prefix = root.slice(0, Math.max(1, 12 - suf.length));
    candidate = `${prefix}${suf}`.slice(0, 12);
  }
  return candidate;
}



projectsRouter.use((req, res, next) => {
  if (!req.context?.workspaceId) {
    return res.status(400).json({ message: "缺少 Workspace 上下文，请登录并选择工作区" });
  }
  next();
});



projectsRouter.post("/", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const { name } = req.body ?? {};

  const trimmedName = typeof name === "string" ? name.trim() : "";

  if (!trimmedName) {

    return res.status(400).json({ message: "name is required" });

  }

  const list = await listProjectsByWorkspace(organizationId, workspaceId);

  const keySet = new Set(list.map((p) => p.key));

  const base = slugKeyFromName(trimmedName);

  const key = allocateAutoProjectKey(base, keySet);

  const project = await createProject({ organizationId, workspaceId, name: trimmedName, key });

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

  const { name } = req.body ?? {};

  if (name == null) {

    return res.status(400).json({ message: "name is required" });

  }

  const trimmedName = String(name).trim();

  if (!trimmedName) {

    return res.status(400).json({ message: "name is required" });

  }

  const project = await updateProject(organizationId, workspaceId, req.params.id, { name: trimmedName });

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

