const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("POST /api/projects creates project with name only and returns auto-generated key", async () => {
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-dingtalk:alice@example.com")
    .set("x-organization-id", "org-alpha")
    .send({ name: "Core Platform" });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name, "Core Platform");
  assert.equal(res.body.description, null);
  assert.ok(res.body.lead?.id);
  assert.ok(res.body.id);
  assert.equal(res.body.key, "COREPLATFORM");
  assert.equal(res.body.organizationId, undefined);
  assert.equal(res.body.workspaceId, undefined);
});

test("POST /api/projects persists trimmed description", async () => {
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-dingtalk:alice@example.com")
    .set("x-organization-id", "org-alpha")
    .send({ name: "Docs", description: "  rollout plan  " });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.description, "rollout plan");
});

test("POST /api/projects rejects leadUserId that is not a workspace member", async () => {
  const alice = await request(app).post("/api/auth/dingtalk").send({ idToken: "dev-dingtalk:alice@m.test" });
  assert.equal(alice.statusCode, 200);
  const wid = alice.body.workspace.id;

  const zoe = await request(app).post("/api/auth/dingtalk").send({ idToken: "dev-dingtalk:zoe@m.test" });
  assert.equal(zoe.statusCode, 200);
  const zoeUserId = zoe.body.user.id;

  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-dingtalk:alice@m.test")
    .set("x-workspace-id", wid)
    .set("x-organization-id", "org-dev")
    .send({ name: "Bad Lead", leadUserId: zoeUserId });

  assert.equal(res.statusCode, 400);
});

test("POST /api/projects ignores client key and auto-generates internally", async () => {
  const org = "org-proj-autogen";
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-dingtalk:alice@example.com")
    .set("x-organization-id", org)
    .send({ name: "Mobile App", key: "SHOULD_BE_IGNORED" });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name, "Mobile App");
  assert.notEqual(res.body.key, "SHOULD_BE_IGNORED");
  assert.equal(res.body.key, "MOBILEAPP");
});
