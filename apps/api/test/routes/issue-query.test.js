const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

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

test("GET /api/issues should filter by teamId", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-team-filter"
  };

  const teamA = await request(app).post("/api/teams").set(headers).send({ name: "Team A" });
  const teamB = await request(app).post("/api/teams").set(headers).send({ name: "Team B" });
  const projectRes = await request(app).post("/api/projects").set(headers).send({ name: "P", key: "PA" });

  await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId: projectRes.body.id, teamId: teamA.body.id, title: "Only A" });
  await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId: projectRes.body.id, teamId: teamB.body.id, title: "Only B" });

  const listA = await request(app).get(`/api/issues?teamId=${teamA.body.id}`).set(headers);
  assert.equal(listA.statusCode, 200);
  assert.equal(listA.body.items.length, 1);
  assert.equal(listA.body.items[0].title, "Only A");
});
