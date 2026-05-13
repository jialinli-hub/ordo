const { prisma } = require("./prisma");

const leadSelect = { id: true, name: true, email: true };

async function createProject({ organizationId, workspaceId, name, key, description, leadUserId }) {
  return prisma.project.create({
    data: {
      organizationId,
      workspaceId,
      name,
      key,
      description: description != null && description !== "" ? description : null,
      leadUserId: leadUserId ?? null
    },
    include: { lead: { select: leadSelect } }
  });
}

async function listProjectsByWorkspace(organizationId, workspaceId) {
  return prisma.project.findMany({
    where: { organizationId, workspaceId },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: leadSelect } }
  });
}

async function getProjectById(organizationId, workspaceId, id) {
  return prisma.project.findFirst({
    where: { id, organizationId, workspaceId },
    include: { lead: { select: leadSelect } }
  });
}

async function updateProject(organizationId, workspaceId, id, changes) {
  const existing = await getProjectById(organizationId, workspaceId, id);
  if (!existing) {
    return null;
  }
  return prisma.project.update({
    where: { id: existing.id },
    data: { ...changes },
    include: { lead: { select: leadSelect } }
  });
}

async function deleteProject(organizationId, workspaceId, id) {
  const existing = await prisma.project.findFirst({
    where: { id, organizationId, workspaceId }
  });
  if (!existing) {
    return null;
  }
  await prisma.project.delete({ where: { id: existing.id } });
  return existing;
}

module.exports = {
  createProject,
  listProjectsByWorkspace,
  getProjectById,
  updateProject,
  deleteProject
};
