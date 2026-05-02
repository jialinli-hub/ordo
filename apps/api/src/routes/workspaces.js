const express = require("express");
const { randomUUID } = require("node:crypto");
const { prisma } = require("../repositories/prisma");

const workspacesRouter = express.Router();

async function getMembership(workspaceId, userId) {
  return prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
}

async function getMyWorkspaces(userId) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: true
    }
  });
  const items = [];
  for (const m of memberships) {
    const ws = m.workspace;
    const memberCount = await prisma.workspaceMember.count({ where: { workspaceId: ws.id } });
    items.push({
      id: ws.id,
      name: ws.name,
      url: ws.url,
      key: ws.key ?? null,
      role: m.role,
      memberCount
    });
  }
  return items;
}

function normalizeWorkspaceUrl(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueWorkspaceUrl(baseUrl, organizationId, excludeWorkspaceId) {
  let candidate = baseUrl || "workspace";
  let index = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.workspace.findFirst({
      where: {
        organizationId,
        id: excludeWorkspaceId ? { not: excludeWorkspaceId } : undefined,
        url: candidate
      }
    });
    if (!clash) {
      return candidate;
    }
    candidate = `${baseUrl}-${index}`;
    index += 1;
  }
}

function mapWorkspace(ws) {
  return {
    id: ws.id,
    organizationId: ws.organizationId,
    name: ws.name,
    url: ws.url,
    key: ws.key ?? null,
    ownerUserId: ws.ownerUserId,
    createdBy: ws.createdBy,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString()
  };
}

workspacesRouter.get("/", async (req, res) => {
  return res.json({ items: await getMyWorkspaces(req.context.userId) });
});

workspacesRouter.get("/mine", async (req, res) => {
  return res.json({ items: await getMyWorkspaces(req.context.userId) });
});

workspacesRouter.post("/", async (req, res) => {
  const { name, key, url } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const orgId = req.context.organizationId;
  const nameClash = await prisma.workspace.findFirst({
    where: { organizationId: orgId, name }
  });
  if (nameClash) {
    return res.status(409).json({ message: "workspace name already exists" });
  }

  const normalizedUrl = normalizeWorkspaceUrl(url || name);
  if (!normalizedUrl) {
    return res.status(400).json({ message: "url is required" });
  }
  const uniqueUrl = await ensureUniqueWorkspaceUrl(normalizedUrl, orgId);

  const uid = req.context.userId;
  const ws = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        organizationId: orgId,
        name,
        url: uniqueUrl,
        key: key || null,
        ownerUserId: uid,
        createdBy: uid
      }
    });
    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: uid,
        role: "owner",
        invitedBy: uid,
        joinedAt: new Date()
      }
    });
    return workspace;
  });

  return res.status(201).json(mapWorkspace(ws));
});

workspacesRouter.patch("/:workspaceId", async (req, res) => {
  const { workspaceId } = req.params;
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    return res.status(404).json({ message: "workspace not found" });
  }
  if (!(await getMembership(workspaceId, req.context.userId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const nextName = String(req.body?.name || "").trim();
  const nextUrl = normalizeWorkspaceUrl(req.body?.url);
  if (!nextName) {
    return res.status(400).json({ message: "name is required" });
  }
  if (!nextUrl) {
    return res.status(400).json({ message: "url is required" });
  }

  const nameClash = await prisma.workspace.findFirst({
    where: {
      organizationId: workspace.organizationId,
      id: { not: workspace.id },
      name: nextName
    }
  });
  if (nameClash) {
    return res.status(409).json({ message: "workspace name already exists" });
  }
  const urlClash = await prisma.workspace.findFirst({
    where: {
      organizationId: workspace.organizationId,
      id: { not: workspace.id },
      url: nextUrl
    }
  });
  if (urlClash) {
    return res.status(409).json({ message: "workspace url already exists" });
  }

  const updated = await prisma.workspace.update({
    where: { id: workspace.id },
    data: { name: nextName, url: nextUrl }
  });
  return res.json(mapWorkspace(updated));
});

workspacesRouter.get("/:workspaceId/members", async (req, res) => {
  const { workspaceId } = req.params;
  if (!(await getMembership(workspaceId, req.context.userId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const members = await prisma.workspaceMember.findMany({ where: { workspaceId } });
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));

  const items = members.map((member) => {
    const user = byId[member.userId];
    return {
      userId: member.userId,
      name: user?.name || "Unknown",
      email: user?.email || null,
      role: member.role,
      joinedAt: member.joinedAt.toISOString()
    };
  });
  return res.json({ items });
});

workspacesRouter.post("/:workspaceId/invites", async (req, res) => {
  const { workspaceId } = req.params;
  const { role = "member" } = req.body ?? {};
  if (!["owner", "admin", "member"].includes(role)) {
    return res.status(422).json({ message: "invalid role" });
  }

  const inviterMembership = await getMembership(workspaceId, req.context.userId);
  if (!inviterMembership || !["owner", "admin"].includes(inviterMembership.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const token = randomUUID();
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId,
      role,
      status: "pending",
      token,
      expiresAt,
      invitedBy: req.context.userId
    }
  });

  const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";
  const inviteLink = `${webBaseUrl}/accept-workspace-invite?token=${encodeURIComponent(token)}`;

  return res.status(201).json({
    inviteId: invite.id,
    role,
    status: invite.status,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    token,
    inviteLink
  });
});

module.exports = { workspacesRouter };
