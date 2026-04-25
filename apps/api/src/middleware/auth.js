const { resolveIdentityFromIdToken } = require("../services/dingtalkIdentityService");

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
  if (!identity) {
    return res.status(401).json({ message: "Invalid idToken" });
  }

  req.auth = { token, identity };
  return next();
}

module.exports = { authMiddleware, parseBearerToken };
