const { randomUUID } = require("node:crypto");
const { store } = require("./memoryStore");

function createProject({ organizationId, name, key }) {
  const project = {
    id: randomUUID(),
    organizationId,
    name,
    key,
    createdAt: new Date().toISOString()
  };

  store.projects.push(project);
  return project;
}

function listProjectsByOrganization(organizationId) {
  return store.projects.filter((project) => project.organizationId === organizationId);
}

module.exports = { createProject, listProjectsByOrganization };
