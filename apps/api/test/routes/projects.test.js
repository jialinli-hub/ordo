const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("POST /api/projects should create project in organization", async () => {
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-dingtalk:alice@example.com")
    .set("x-organization-id", "org-alpha")
    .send({ name: "Core Platform", key: "CORE" });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name, "Core Platform");
  assert.equal(res.body.key, "CORE");
  assert.equal(res.body.organizationId, "org-alpha");
  assert.ok(res.body.workspaceId);
});
