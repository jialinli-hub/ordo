const { randomUUID } = require("node:crypto");

const { prisma } = require("../repositories/prisma");
const { ensureUserFromLoginIdentity } = require("../services/ensureDingTalkRegisteredUser");



function normalizeWorkspaceUrl(input) {

  return String(input || "")

    .trim()

    .toLowerCase()

    .replace(/[^a-z0-9-]/g, "-")

    .replace(/-+/g, "-")

    .replace(/^-|-$/g, "");

}



async function ensureDefaultWorkspace(tx, identity, organizationIdFromHeader, userId) {

  const hasAny = await tx.workspaceMember.findFirst({

    where: { userId }

  });

  if (!hasAny) {

    let base = normalizeWorkspaceUrl(`${identity.name}-workspace`) || null;

    if (!base || base === "") {

      base = `workspace-${randomUUID().slice(0, 8)}`;

    }



    let url = base;

    let attempt = 2;

    // eslint-disable-next-line no-constant-condition

    while (true) {

      const clash = await tx.workspace.findFirst({

        where: { organizationId: organizationIdFromHeader, url }

      });

      if (!clash) {

        break;

      }

      url = `${base}-${attempt}`;

      attempt += 1;

    }



    await tx.workspace.create({

      data: {

        organizationId: organizationIdFromHeader,

        name: `${identity.name}'s Workspace`,

        url,

        ownerUserId: userId,

        createdBy: userId,

        members: {

          create: {

            userId,

            role: "owner",

            invitedBy: userId,

            joinedAt: new Date()

          }

        }

      }

    });

  }

}



async function tenantMiddleware(req, res, next) {

  try {

    req.context = req.context || {};

    if (req.auth?.mcpOAuth) {
      const { userId, workspaceId, organizationId } = req.auth.mcpOAuth;
      const mem = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId }
      });
      if (!mem) {
        return res.status(403).json({ message: "Forbidden" });
      }
      req.context.userId = userId;
      req.context.workspaceId = workspaceId;
      req.context.organizationId = organizationId;
      return next();
    }

    const identity = req.auth?.identity;

    const organizationIdFromHeader = req.headers["x-organization-id"] || "org-dev";



    let user = identity ? await ensureUserFromLoginIdentity(identity, prisma) : null;



    if (identity && user) {

      await prisma.$transaction(async (tx) => {

        await ensureDefaultWorkspace(tx, identity, organizationIdFromHeader, user.id);

      });

    }



    const memberships = await prisma.workspaceMember.findMany({

      where: { userId: user?.id }

    });



    const requestedWorkspaceId = req.headers["x-workspace-id"];

    const selectedMembership =

      memberships.find((item) => item.workspaceId === requestedWorkspaceId) || memberships[0];



    let workspace =

      selectedMembership &&

      (await prisma.workspace.findUnique({ where: { id: selectedMembership.workspaceId } }));



    req.context.organizationId =

      workspace?.organizationId || organizationIdFromHeader || null;

    /** 必须是 Workspace 表主键（UUID），绝不能回退为 organizationId 字符串，否则 Project 外键会插入失败 */
    req.context.workspaceId = workspace?.id ?? null;

    req.context.userId = user?.id || null;

    next();

  } catch (e) {

    next(e);

  }

}



module.exports = { tenantMiddleware };

