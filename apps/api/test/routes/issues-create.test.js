const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("POST /api/issues should assign incremental issueNumber per project", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-issue"
  };

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Issue Project", key: "ISS" });
  const projectId = projectRes.body.id;

  const first = await request(app)
    .post("/api/issues")
    .set(authHeaders)
    .send({ projectId, title: "First issue" });
  const second = await request(app)
    .post("/api/issues")
    .set(authHeaders)
    .send({ projectId, title: "Second issue" });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.body.issueNumber, 1);
  assert.equal(second.body.issueNumber, 2);
});
