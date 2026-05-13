const express = require("express");
const { prisma } = require("../repositories/prisma");

const workspaceInvitesRouter = express.Router();

workspaceInvitesRouter.get("/preview", async (req, res) => {
  const token = String(req.query?.token || "").trim();
  const teamHint = String(req.query?.team || "").trim();

  if (!token) {
    return res.status(400).json({ message: "token is required" });
  }

  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    include: {
      workspace: {
        select: { id: true, name: true, url: true }
      }
    }
  });

  if (!invite || invite.status === "revoked") {
    return res.status(404).json({ message: "invite not found" });
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "expired" }
    });
    return res.status(410).json({ message: "invite expired" });
  }

  /** @type {{ id: string, name: string } | null} */
  let team = null;

  if (invite.contextTeamId) {
    const row = await prisma.team.findFirst({
      where: { id: invite.contextTeamId, workspaceId: invite.workspaceId },
      select: { id: true, name: true }
    });
    team = row;
  } else if (teamHint) {
    const row = await prisma.team.findFirst({
      where: { id: teamHint, workspaceId: invite.workspaceId },
      select: { id: true, name: true }
    });
    if (row) {
      team = row;
    }
  }

  return res.status(200).json({
    workspace: invite.workspace,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    team
  });
});

workspaceInvitesRouter.get("/accept", async (req, res) => {
  const token = req.query?.token;
  if (!token) {
    return res.status(400).json({ message: "token is required" });
  }

  const invite = await prisma.workspaceInvite.findUnique({ where: { token } });
  if (!invite || invite.status === "revoked") {
    return res.status(404).json({ message: "invite not found" });
  }
  /** 链接在有效期内可多人多次使用（含历史库中仍为 accepted 的记录，只要未过期仍可加入） */
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "expired" }
    });
    return res.status(410).json({ message: "invite expired" });
  }

  const email = req.auth?.identity?.email;
  let user =
    email != null ? await prisma.user.findUnique({ where: { email } }) : null;

  if (!user && email) {
    user = await prisma.user.create({
      data: {
        email,
        name: req.auth?.identity?.name || email.split("@")[0],
        avatarUrl: req.auth?.identity?.picture || null
      }
    });
  }
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await prisma.$transaction(async (tx) => {
    const existingMembership = await tx.workspaceMember.findFirst({
      where: { workspaceId: invite.workspaceId, userId: user.id }
    });
    if (!existingMembership) {
      await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
          invitedBy: invite.invitedBy,
          joinedAt: new Date()
        }
      });
    }
  });

  return res.status(200).json({
    workspaceId: invite.workspaceId,
    status: "accepted",
    contextTeamId: invite.contextTeamId
  });
});

module.exports = { workspaceInvitesRouter };
