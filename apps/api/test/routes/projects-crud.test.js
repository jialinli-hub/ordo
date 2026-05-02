const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("project should support create read update delete", async () => {
  const auth = {
    Authorization: "Bearer dev-dingtalk:owner@example.com",
    "x-organization-id": "org-project-crud"
  };

  const createRes = await request(app)
    .post("/api/projects")
    .set(auth)
    .send({ name: "Core Platform", key: "CORE" });
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.name, "Core Platform");
  const projectId = createRes.body.id;

  const listRes = await request(app).get("/api/projects").set(auth);
  assert.equal(listRes.statusCode, 200);
  assert.ok(listRes.body.items.some((item) => item.id === projectId));

  const readRes = await request(app).get(`/api/projects/${projectId}`).set(auth);
  assert.equal(readRes.statusCode, 200);
  assert.equal(readRes.body.id, projectId);

  const updateRes = await request(app)
    .patch(`/api/projects/${projectId}`)
    .set(auth)
    .send({ name: "Core Platform V2", key: "CORE2" });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.name, "Core Platform V2");
  assert.equal(updateRes.body.key, "CORE2");

  const deleteRes = await request(app).delete(`/api/projects/${projectId}`).set(auth);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.deleted, true);

  const readAfterDeleteRes = await request(app).get(`/api/projects/${projectId}`).set(auth);
  assert.equal(readAfterDeleteRes.statusCode, 404);
});

test("project key uniqueness should be scoped by workspace", async () => {
  const auth = {
    Authorization: "Bearer dev-dingtalk:owner@example.com",
    "x-organization-id": "org-project-scope"
  };

  const loginRes = await request(app).post("/api/auth/dingtalk").send({ idToken: "dev-dingtalk:owner@example.com" });
  assert.equal(loginRes.statusCode, 200);

  const firstWorkspaceId = loginRes.body.workspace.id;
  const createWorkspaceRes = await request(app)
    .post("/api/workspaces")
    .set({ ...auth, "x-workspace-id": firstWorkspaceId })
    .send({ name: "Workspace B" });
  assert.equal(createWorkspaceRes.statusCode, 201);
  const secondWorkspaceId = createWorkspaceRes.body.id;

  const firstCreateRes = await request(app)
    .post("/api/projects")
    .set({ ...auth, "x-workspace-id": firstWorkspaceId })
    .send({ name: "Core A", key: "CORE" });
  assert.equal(firstCreateRes.statusCode, 201);

  const duplicateSameWorkspaceRes = await request(app)
    .post("/api/projects")
    .set({ ...auth, "x-workspace-id": firstWorkspaceId })
    .send({ name: "Core A2", key: "CORE" });
  assert.equal(duplicateSameWorkspaceRes.statusCode, 409);

  const sameKeyOtherWorkspaceRes = await request(app)
    .post("/api/projects")
    .set({ ...auth, "x-workspace-id": secondWorkspaceId })
    .send({ name: "Core B", key: "CORE" });
  assert.equal(sameKeyOtherWorkspaceRes.statusCode, 201);
});
