const { prisma } = require("./prisma");



async function createProject({ organizationId, workspaceId, name, key }) {

  return prisma.project.create({

    data: { organizationId, workspaceId, name, key }

  });

}



async function listProjectsByWorkspace(organizationId, workspaceId) {

  return prisma.project.findMany({

    where: { organizationId, workspaceId },

    orderBy: { createdAt: "desc" }

  });

}



async function getProjectById(organizationId, workspaceId, id) {

  return prisma.project.findFirst({

    where: { id, organizationId, workspaceId }

  });

}



async function updateProject(organizationId, workspaceId, id, changes) {

  const existing = await getProjectById(organizationId, workspaceId, id);

  if (!existing) {

    return null;

  }

  return prisma.project.update({

    where: { id: existing.id },

    data: { ...changes }

  });

}



async function deleteProject(organizationId, workspaceId, id) {

  const existing = await getProjectById(organizationId, workspaceId, id);

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

