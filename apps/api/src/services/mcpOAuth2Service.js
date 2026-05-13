const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { prisma } = require("../repositories/prisma");

const DEFAULT_AUD = "ordo-api";
const DEFAULT_TTL_SEC = 3600;

function getJwtSecret() {
  const s = process.env.ORDO_OAUTH_JWT_SECRET;
  if (!s || String(s).length < 16) {
    return null;
  }
  return String(s);
}

function parseClients() {
  const raw = process.env.ORDO_OAUTH_CLIENTS_JSON;
  if (!raw || !String(raw).trim()) {
    return [];
  }
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) {
      return [];
    }
    return arr
      .map((row) => ({
        clientId: String(row.clientId || "").trim(),
        clientSecret: String(row.clientSecret || ""),
        workspaceId: String(row.workspaceId || "").trim(),
        userId: String(row.userId || "").trim()
      }))
      .filter((c) => c.clientId && c.clientSecret && c.workspaceId && c.userId);
  } catch {
    return [];
  }
}

function issuerBaseUrl() {
  const explicit = process.env.ORDO_OAUTH_ISSUER;
  if (explicit && String(explicit).trim()) {
    return String(explicit).replace(/\/$/, "");
  }
  const port = Number(process.env.PORT) || 3000;
  return `http://127.0.0.1:${port}`;
}

function authorizationServerMetadata() {
  const issuer = issuerBaseUrl();
  return {
    issuer,
    token_endpoint: `${issuer}/api/oauth/token`,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    response_types_supported: ["token"],
    scopes_supported: ["mcp"],
    code_challenge_methods_supported: []
  };
}

async function issueClientCredentialsAccessToken(clientId, clientSecret) {
  const secret = getJwtSecret();
  if (!secret) {
    return { error: "server_error", error_description: "ORDO_OAUTH_JWT_SECRET not configured" };
  }
  const clients = parseClients();
  const client = clients.find((c) => c.clientId === clientId && c.clientSecret === clientSecret);
  if (!client) {
    return { error: "invalid_client", error_description: "unknown client_id or client_secret" };
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: client.workspaceId },
    select: { id: true, organizationId: true }
  });
  if (!ws) {
    return { error: "invalid_grant", error_description: "workspace not found" };
  }
  const mem = await prisma.workspaceMember.findFirst({
    where: { workspaceId: client.workspaceId, userId: client.userId }
  });
  if (!mem) {
    return { error: "invalid_grant", error_description: "user is not a member of workspace" };
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.ORDO_OAUTH_ACCESS_TOKEN_TTL_SEC) || DEFAULT_TTL_SEC;
  const jti = crypto.randomUUID();
  const payload = {
    sub: client.userId,
    wid: client.workspaceId,
    oid: ws.organizationId,
    cid: client.clientId,
    aud: process.env.ORDO_OAUTH_JWT_AUD || DEFAULT_AUD,
    iss: issuerBaseUrl(),
    iat: now,
    exp: now + ttl,
    jti,
    scope: "mcp"
  };
  const access_token = jwt.sign(payload, secret, { algorithm: "HS256" });
  return {
    access_token,
    token_type: "Bearer",
    expires_in: ttl,
    scope: "mcp"
  };
}

function verifyMcpAccessToken(bearerToken) {
  const secret = getJwtSecret();
  if (!secret || !bearerToken) {
    return null;
  }
  try {
    const decoded = jwt.verify(bearerToken, secret, {
      algorithms: ["HS256"],
      audience: process.env.ORDO_OAUTH_JWT_AUD || DEFAULT_AUD
    });
    if (!decoded || typeof decoded !== "object") {
      return null;
    }
    const userId = decoded.sub;
    const workspaceId = decoded.wid;
    const organizationId = decoded.oid;
    if (!userId || !workspaceId || !organizationId) {
      return null;
    }
    return {
      userId: String(userId),
      workspaceId: String(workspaceId),
      organizationId: String(organizationId),
      clientId: decoded.cid != null ? String(decoded.cid) : null,
      jti: decoded.jti != null ? String(decoded.jti) : null
    };
  } catch {
    return null;
  }
}

module.exports = {
  authorizationServerMetadata,
  issueClientCredentialsAccessToken,
  verifyMcpAccessToken,
  getJwtSecret,
  parseClients
};
