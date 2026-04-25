const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("GET /api/issues should support status filter and pagination", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-query"
  };

  const projectRes = await request(app)
    .post("/api/projects")
    .set(headers)
    .send({ name: "Query Project", key: "QRY" });
  const projectId = projectRes.body.id;

  await request(app).post("/api/issues").set(headers).send({ projectId, title: "Todo issue" });
  const inProgressIssue = await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId, title: "In progress issue" });
  await request(app)
    .patch(`/api/issues/${inProgressIssue.body.id}/status`)
    .set(headers)
    .send({ status: "in_progress" });

  const listRes = await request(app)
    .get("/api/issues?status=todo&page=1&pageSize=1")
    .set(headers);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.items.length, 1);
  assert.equal(listRes.body.pageInfo.page, 1);

  const boardRes = await request(app).get("/api/issues/board").set(headers);
  assert.equal(boardRes.statusCode, 200);
  assert.ok(boardRes.body.todo.length >= 1);
  assert.ok(boardRes.body.in_progress.length >= 1);
});
