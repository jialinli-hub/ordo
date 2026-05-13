const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("GET /api/search/quick matches project key/name and issue issuesId/title", async () => {
  const loginRes = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:quicksearch@example.com" });

  assert.equal(loginRes.statusCode, 200);
  const auth = { Authorization: `Bearer ${loginRes.body.accessToken}` };

  const teamRes = await request(app).post("/api/teams").set(auth).send({ name: "Quick Team", identifier: "QT" });
  assert.equal(teamRes.statusCode, 201);
  const teamId = teamRes.body.id;

  const projectRes = await request(app).post("/api/projects").set(auth).send({ name: "Zeta Module" });
  assert.equal(projectRes.statusCode, 201);
  const projectId = projectRes.body.id;
  const projectKey = projectRes.body.key;

  const issueRes = await request(app).post("/api/issues").set(auth).send({
    projectId,
    teamId,
    title: "UniqueSearchableTitleXy"
  });
  assert.equal(issueRes.statusCode, 201);
  const issuesId = issueRes.body.issues_id;

  const byTitle = await request(app)
    .get(`/api/search/quick?q=${encodeURIComponent("UniqueSearchableTitleXy")}`)
    .set(auth);
  assert.equal(byTitle.statusCode, 200);
  assert.ok(byTitle.body.issues.some((i) => i.issuesId === issuesId));

  const byIssuesId = await request(app).get(`/api/search/quick?q=${encodeURIComponent(issuesId)}`).set(auth);
  assert.equal(byIssuesId.statusCode, 200);
  assert.ok(byIssuesId.body.issues.some((i) => i.id === issueRes.body.id));

  const byProjectName = await request(app).get(`/api/search/quick?q=${encodeURIComponent("Zeta")}`).set(auth);
  assert.equal(byProjectName.statusCode, 200);
  assert.ok(byProjectName.body.projects.some((p) => p.id === projectId));

  assert.ok(typeof projectKey === "string" && projectKey.length > 0);
  const byKey = await request(app).get(`/api/search/quick?q=${encodeURIComponent(projectKey)}`).set(auth);
  assert.equal(byKey.statusCode, 200);
  assert.ok(byKey.body.projects.some((p) => p.id === projectId));

  const empty = await request(app).get("/api/search/quick?q=").set(auth);
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.body.projects.length, 0);
  assert.equal(empty.body.issues.length, 0);
});
