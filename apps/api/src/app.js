const path = require("path");
require("express-async-errors");
const express = require("express");
const cors = require("cors");
const { authMiddleware } = require("./middleware/auth");
const { tenantMiddleware } = require("./middleware/tenant");
const { organizationsRouter } = require("./routes/organizations");
const { projectsRouter } = require("./routes/projects");
const { issuesRouter } = require("./routes/issues");
const { issueTransitionsRouter } = require("./routes/issueTransitions");
const { cyclesRouter } = require("./routes/cycles");
const { issueQueryRouter } = require("./routes/issueQuery");
const { authRouter } = require("./routes/auth");
const { profileRouter } = require("./routes/profile");
const { issueViewPrefsRouter } = require("./routes/issueViewPreferences");
const { workspacesRouter } = require("./routes/workspaces");
const { workspaceInvitesRouter } = require("./routes/workspaceInvites");
const { teamsRouter } = require("./routes/teams");
const { prisma } = require("./repositories/prisma");
const { summarizeDatabaseUrl } = require("./utils/databaseSummary");

const app = express();
const webDist = path.join(__dirname, "../../web/dist");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
      "http://localhost:5175",
      "http://127.0.0.1:5175"
    ]
  })
);
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ status: "error", database: "DATABASE_URL_not_configured" });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    const exposeDb =
      process.env.NODE_ENV !== "production" || process.env.ORDO_HEALTH_DB_DETAIL === "1";
    /** @type {Record<string, unknown>} */
    const body = { status: "ok", database: "postgresql_connected" };
    if (exposeDb) {
      body.connection = summarizeDatabaseUrl(process.env.DATABASE_URL);
      try {
        body.userTableRowCount = await prisma.user.count();
      } catch (err) {
        body.userTableRowCountError = String(err?.message || err);
      }
    }
    return res.json(body);
  } catch {
    return res.status(503).json({ status: "error", database: "postgresql_unreachable" });
  }
});

app.use("/api/auth", authRouter);
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/auth/")) {
    return next();
  }
  return authMiddleware(req, res, next);
});
app.use("/api", tenantMiddleware);
app.use("/api/profile", profileRouter);
app.use("/api/issue-view-preferences", issueViewPrefsRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/workspace-invites", workspaceInvitesRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/issues", issueQueryRouter);
app.use("/api/issues", issuesRouter);
app.use("/api/issues", issueTransitionsRouter);
app.use("/api/cycles", cyclesRouter);

app.use((err, _req, res, _next) => {
  console.error("[api:error]", err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({ message: err?.message || "Internal server error" });
  }
});

app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

module.exports = app;
