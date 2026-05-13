const express = require("express");

const { prisma } = require("../repositories/prisma");

const {
  createProject,
  listProjectsByWorkspace,
  getProjectById,
  updateProject,
  deleteProject
} = require("../repositories/projectRepository");



const {
  notifyTeamsDingTalk,
  formatProjectNotify,
  buildProjectDeepLink,
  buildWorkspaceHomeDeepLink,
  publicWebBase
} = require("../services/teamNotifications");
const { makeKey, getJson, setJson, invalidateWorkspace } = require("../services/workspaceReadCache");

const projectsRouter = express.Router();



function mapProject(p) {
  const lead =
    p.lead && p.lead.id
      ? { id: p.lead.id, name: p.lead.name, email: p.lead.email }
      : null;
  return {
    id: p.id,
    name: p.name,
    key: p.key,
    description: p.description ?? null,
    lead,
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
  const { name, description, leadUserId: leadRaw } = req.body ?? {};

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return res.status(400).json({ message: "name is required" });
  }

  let resolvedLead = req.context.userId;
  if (leadRaw != null && String(leadRaw).trim() !== "") {
    resolvedLead = String(leadRaw).trim();
  }
  if (!resolvedLead) {
    return res.status(400).json({ message: "leadUserId is required" });
  }

  const leadMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: resolvedLead }
  });
  if (!leadMember) {
    return res.status(400).json({ message: "leadUserId must be a workspace member" });
  }

  const desc = description != null && typeof description === "string" ? description.trim() : "";

  const list = await listProjectsByWorkspace(organizationId, workspaceId);

  const keySet = new Set(list.map((p) => p.key));

  const base = slugKeyFromName(trimmedName);

  const key = allocateAutoProjectKey(base, keySet);

  const project = await createProject({
    organizationId,
    workspaceId,
    name: trimmedName,
    key,
    description: desc || null,
    leadUserId: resolvedLead
  });
  invalidateWorkspace(workspaceId);

  void (async () => {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { url: true } });
    const landingUrl =
      buildProjectDeepLink({
        publicBase: publicWebBase(),
        workspaceUrlSlug: ws?.url,
        projectId: project.id
      }) || buildWorkspaceHomeDeepLink(publicWebBase(), ws?.url);
    await notifyTeamsDingTalk({
      workspaceId,
      teamId: null,
      text: formatProjectNotify({
        action: "created",
        name: project.name,
        key: project.key,
        landingUrl
      })
    });
  })().catch((e) => {
    console.warn("[notify:dingtalk] project created send failed", e?.message || e);
  });

  return res.status(201).json(mapProject(project));

});



projectsRouter.get("/", async (req, res) => {
  const organizationId = req.context.organizationId;
  const workspaceId = req.context.workspaceId;
  const cacheKey = makeKey(["v2", workspaceId, "projects", organizationId]);
  const hit = getJson(cacheKey);
  if (hit) {
    return res.json(hit);
  }
  const projects = await listProjectsByWorkspace(organizationId, workspaceId);
  const body = { items: projects.map(mapProject) };
  setJson(cacheKey, body);
  return res.json(body);
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
  invalidateWorkspace(workspaceId);

  return res.json(mapProject(project));

});



projectsRouter.delete("/:id", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const removed = await deleteProject(organizationId, workspaceId, req.params.id);

  if (!removed) {

    return res.status(404).json({ message: "Project not found" });

  }
  invalidateWorkspace(workspaceId);

  void (async () => {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { url: true } });
    const landingUrl = buildWorkspaceHomeDeepLink(publicWebBase(), ws?.url);
    await notifyTeamsDingTalk({
      workspaceId,
      teamId: null,
      text: formatProjectNotify({
        action: "deleted",
        name: removed.name,
        key: removed.key,
        landingUrl
      })
    });
  })().catch((e) => {
    console.warn("[notify:dingtalk] project deleted send failed", e?.message || e);
  });

  return res.json({ id: removed.id, deleted: true });

});



module.exports = { projectsRouter };

