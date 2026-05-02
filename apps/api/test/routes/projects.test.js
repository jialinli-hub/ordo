const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("POST /api/projects creates project with name only (no key in response)", async () => {
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-dingtalk:alice@example.com")
    .set("x-organization-id", "org-alpha")
    .send({ name: "Core Platform" });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name, "Core Platform");
  assert.ok(res.body.id);
  assert.equal(res.body.key, undefined);
  assert.equal(res.body.organizationId, undefined);
  assert.equal(res.body.workspaceId, undefined);
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
  assert.equal(res.body.key, undefined);
});
