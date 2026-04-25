const express = require("express");
const { randomUUID } = require("node:crypto");
const { store } = require("../repositories/memoryStore");
const { resolveIdentityFromIdToken } = require("../services/dingtalkIdentityService");

const authRouter = express.Router();

function upsertUserAndWorkspace(identity) {
  let user = store.users.find((item) => item.email === identity.email);
  if (!user) {
    user = {
      id: randomUUID(),
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.picture
    };
    store.users.push(user);
  }

  const existingWorkspace = store.workspaces.find((item) => item.ownerUserId === user.id);
  const workspace =
    existingWorkspace ||
    (() => {
      const created = {
        id: randomUUID(),
        name: `${user.name}'s Workspace`,
        ownerUserId: user.id
      };
      store.workspaces.push(created);
      return created;
    })();

  return { user, workspace };
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

  const { user, workspace } = upsertUserAndWorkspace(identity);

  return res.status(200).json({
    accessToken: idToken,
    tokenType: "id_token",
    user,
    workspace
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
  const { user, workspace } = upsertUserAndWorkspace(identity);
  console.log("[dingtalk] upsert user/workspace", {
    userId: user.id,
    workspaceId: workspace.id
  });

  return res.status(200).json({
    accessToken,
    tokenType: "access_token",
    user,
    workspace
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

  const { user, workspace } = upsertUserAndWorkspace(identity);
  console.log("[dingtalk] upsert user/workspace", {
    userId: user.id,
    workspaceId: workspace.id
  });

  const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";
  const redirectUrl = new URL(webBaseUrl);
  redirectUrl.searchParams.set("accessToken", accessToken);
  console.log("[dingtalk] redirect to web", { url: redirectUrl.toString() });
  return res.redirect(redirectUrl.toString());
});

module.exports = { authRouter };
