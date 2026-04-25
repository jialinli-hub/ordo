const path = require("path");
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
const { workspacesRouter } = require("./routes/workspaces");
const { teamsRouter } = require("./routes/teams");

const app = express();
const webDist = path.join(__dirname, "../../web/dist");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174"
    ]
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
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
app.use("/api/workspaces", workspacesRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/issues", issuesRouter);
app.use("/api/issues", issueTransitionsRouter);
app.use("/api/issues", issueQueryRouter);
app.use("/api/cycles", cyclesRouter);

app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

module.exports = app;
