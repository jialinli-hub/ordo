const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("PATCH /api/issues/:id/status should reject invalid transition", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-transition"
  };

  const projectRes = await request(app)
    .post("/api/projects")
    .set(headers)
    .send({ name: "Transition Project", key: "TRN" });
  const issueRes = await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId: projectRes.body.id, title: "State issue" });

  const transitionRes = await request(app)
    .patch(`/api/issues/${issueRes.body.id}/status`)
    .set(headers)
    .send({ status: "done" });

  assert.equal(transitionRes.statusCode, 400);
});
