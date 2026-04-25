const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");

function tenantMiddleware(req, _res, next) {
  req.context = req.context || {};
  const identity = req.auth?.identity;

  let user = store.users.find((item) => item.email === identity?.email);
  if (!user && identity) {
    user = {
      id: randomUUID(),
      email: identity.email,
      name: identity.name,
      avatarUrl: null
    };
    store.users.push(user);
  }

  let workspace = store.workspaces.find((item) => item.ownerUserId === user?.id);
  if (!workspace && user) {
    workspace = {
      id: randomUUID(),
      name: `${user.name}'s Workspace`,
      ownerUserId: user.id
    };
    store.workspaces.push(workspace);
  }

  req.context.organizationId =
    req.headers["x-organization-id"] || workspace?.id || "org-dev";
  req.context.workspaceId = workspace?.id || req.context.organizationId;
  req.context.userId = user?.id || null;
  next();
}

module.exports = { tenantMiddleware };
