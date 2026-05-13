const express = require("express");
const { prisma } = require("../repositories/prisma");
const { resolveIdentityFromIdToken } = require("../services/dingtalkIdentityService");
const { ensureUserFromLoginIdentity } = require("../services/ensureDingTalkRegisteredUser");

const authRouter = express.Router();

function normalizeWorkspaceUrl(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function upsertUserAndWorkspace(identity) {
  const organizationId = "org-dev";

  await prisma.organization.upsert({
    where: { id: organizationId },
    create: { id: organizationId, name: "Default organization" },
    update: {}
  });

  const user = await ensureUserFromLoginIdentity(identity, prisma);
  if (!user) {
    throw new Error("failed to register user from identity");
  }

  let workspace = await prisma.workspace.findFirst({
    where: { organizationId, ownerUserId: user.id }
  });

  if (!workspace) {
    const base = normalizeWorkspaceUrl(`${user.name}-workspace`) || `workspace-${user.id.slice(0, 8)}`;
    let candidate = base;
    let n = 2;
    while (
      await prisma.workspace.findFirst({ where: { organizationId, url: candidate } })
    ) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    workspace = await prisma.workspace.create({
      data: {
        organizationId,
        name: `${user.name}'s Workspace`,
        url: candidate,
        ownerUserId: user.id,
        createdBy: user.id
      }
    });
  }

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: user.id }
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
      invitedBy: user.id,
      joinedAt: new Date()
    }
  });

  return { user, workspace };
}

function mapUserPublic(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl
  };
}

function mapWorkspacePublic(ws) {
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

function buildDingTalkAuthorizeUrl(redirectUri = process.env.DINGTALK_REDIRECT_URI) {
  const clientId = process.env.DINGTALK_CLIENT_ID;
  const state = "ordo_login";
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: "code",
    client_id: clientId,
    scope: "openid",
    state,
    prompt: "consent"
  });
  return `https://login.dingtalk.com/oauth2/auth?${params.toString()}`;
}

async function exchangeCodeForAccessToken(authCode, redirectUri = process.env.DINGTALK_REDIRECT_URI) {
  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      clientId: process.env.DINGTALK_CLIENT_ID,
      clientSecret: process.env.DINGTALK_CLIENT_SECRET,
      code: authCode,
      grantType: "authorization_code",
      redirectUri,
      redirect_uri: redirectUri
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("[dingtalk] exchange token failed", {
      status: response.status,
      body: errText
    });
    return null;
  }
  const data = await response.json();
  const logPayload = { ...data };
  if (logPayload.accessToken) {
    logPayload.accessToken = `[redacted len=${String(logPayload.accessToken).length}]`;
  }
  if (logPayload.refreshToken) {
    logPayload.refreshToken = "[redacted]";
  }
  console.log("[dingtalk] oauth2/userAccessToken 响应体", logPayload);
  console.log("[dingtalk] exchange token success", {
    hasAccessToken: Boolean(data.accessToken),
    expireIn: data.expireIn,
    corpId: data.corpId
  });
  return data.accessToken || null;
}

authRouter.post("/dingtalk", async (req, res) => {
  const { idToken } = req.body ?? {};
  const identity = await resolveIdentityFromIdToken(idToken);
  if (!identity) {
    return res.status(400).json({
      message: "Invalid DingTalk token"
    });
  }

  const { user, workspace } = await upsertUserAndWorkspace(identity);
  if (process.env.NODE_ENV !== "production") {
    console.log(`[ordo-auth] POST /dingtalk id_token OK userId=${user.id}`);
  }

  return res.status(200).json({
    accessToken: idToken,
    tokenType: "id_token",
    user: mapUserPublic(user),
    workspace: mapWorkspacePublic(workspace)
  });
});

authRouter.get("/dingtalk/authorize", (_req, res) => {
  if (!process.env.DINGTALK_CLIENT_ID || !process.env.DINGTALK_REDIRECT_URI) {
    return res.status(500).json({ message: "DingTalk OAuth config missing" });
  }
  const authUrl = buildDingTalkAuthorizeUrl();
  console.log("[dingtalk] authorize redirect", { url: authUrl });
  return res.redirect(authUrl);
});

authRouter.post("/dingtalk/exchange-code", async (req, res) => {
  const authCode = req.body?.authCode || req.body?.code;
  const redirectUri = req.body?.redirectUri || process.env.DINGTALK_REDIRECT_URI;
  console.log("[dingtalk] exchange-code request", {
    hasAuthCode: Boolean(authCode),
    redirectUri
  });
  if (!authCode) {
    return res.status(400).json({ message: "Missing authCode/code" });
  }

  const accessToken = await exchangeCodeForAccessToken(String(authCode), redirectUri);
  if (!accessToken) {
    return res.status(400).json({ message: "Failed to exchange DingTalk auth code" });
  }

  const identity = await resolveIdentityFromIdToken(accessToken);
  if (!identity) {
    return res.status(400).json({ message: "Failed to fetch DingTalk user profile" });
  }

  console.log("[dingtalk] resolved identity", {
    email: identity.email || null,
    name: identity.name || null,
    hasAvatar: Boolean(identity.picture)
  });
  const { user, workspace } = await upsertUserAndWorkspace(identity);
  console.log("[dingtalk] upsert user/workspace", {
    userId: user.id,
    workspaceId: workspace.id
  });
  if (process.env.NODE_ENV !== "production") {
    console.log(`[ordo-auth] POST /dingtalk/exchange-code OK userId=${user.id}`);
  }

  return res.status(200).json({
    accessToken,
    tokenType: "access_token",
    user: mapUserPublic(user),
    workspace: mapWorkspacePublic(workspace)
  });
});

authRouter.get("/dingtalk/callback", async (req, res) => {
  const authCode = req.query.authCode || req.query.code;
  console.log("[dingtalk] callback query", {
    hasAuthCode: Boolean(authCode),
    state: req.query.state || null
  });
  if (!authCode) {
    return res.status(400).json({ message: "Missing authCode/code" });
  }

  const accessToken = await exchangeCodeForAccessToken(String(authCode), process.env.DINGTALK_REDIRECT_URI);
  if (!accessToken) {
    return res.status(400).json({ message: "Failed to exchange DingTalk auth code" });
  }

  const identity = await resolveIdentityFromIdToken(accessToken);
  if (!identity) {
    return res.status(400).json({ message: "Failed to fetch DingTalk user profile" });
  }

  console.log("[dingtalk] resolved identity", {
    email: identity.email || null,
    name: identity.name || null,
    hasAvatar: Boolean(identity.picture)
  });

  await upsertUserAndWorkspace(identity);

  const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";
  const redirectUrl = new URL(webBaseUrl);
  redirectUrl.searchParams.set("accessToken", accessToken);
  console.log("[dingtalk] redirect to web", { url: redirectUrl.toString() });
  return res.redirect(redirectUrl.toString());
});

module.exports = { authRouter };
