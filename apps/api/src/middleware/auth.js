const { resolveIdentityFromIdToken } = require("../services/dingtalkIdentityService");
const { verifyMcpAccessToken } = require("../services/mcpOAuth2Service");

function parseBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length).trim();
}

async function authMiddleware(req, res, next) {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const identity = await resolveIdentityFromIdToken(token);
  if (identity) {
    req.auth = { token, identity };
    return next();
  }

  const mcpOAuth = verifyMcpAccessToken(token);
  if (mcpOAuth) {
    req.auth = { token, identity: null, mcpOAuth };
    return next();
  }

  return res.status(401).json({ message: "Invalid idToken" });
}

module.exports = { authMiddleware, parseBearerToken };
