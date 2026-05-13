const express = require("express");
const {
  authorizationServerMetadata,
  issueClientCredentialsAccessToken
} = require("../services/mcpOAuth2Service");

const oauthMcpRouter = express.Router();
oauthMcpRouter.use(express.urlencoded({ extended: false }));

oauthMcpRouter.post("/token", async (req, res) => {
  const grant_type = req.body?.grant_type;
  if (grant_type !== "client_credentials") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "only client_credentials is supported"
    });
  }
  let client_id = req.body?.client_id;
  let client_secret = req.body?.client_secret;
  const authz = req.headers.authorization;
  if ((!client_id || !client_secret) && authz && authz.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authz.slice("Basic ".length).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        client_id = client_id || decoded.slice(0, idx);
        client_secret = client_secret || decoded.slice(idx + 1);
      }
    } catch {
      /* ignore */
    }
  }
  if (!client_id || !client_secret) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "client_id and client_secret required"
    });
  }
  const out = await issueClientCredentialsAccessToken(String(client_id), String(client_secret));
  if (out.error) {
    const status = out.error === "invalid_client" ? 401 : 400;
    return res.status(status).json(out);
  }
  return res.status(200).json(out);
});

function wellKnownOAuthAuthorizationServer(req, res) {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(authorizationServerMetadata());
}

module.exports = { oauthMcpRouter, wellKnownOAuthAuthorizationServer };
