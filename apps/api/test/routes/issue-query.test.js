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

test("GET /api/issues?mine=1 should return only issues assigned to current user", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-mine-issues"
  };

  const profileRes = await request(app).get("/api/profile").set(headers);
  assert.equal(profileRes.statusCode, 200);
  const aliceId = profileRes.body.id;

  const projectRes = await request(app).post("/api/projects").set(headers).send({ name: "Mine P", key: "MN" });
  assert.equal(projectRes.statusCode, 201);

  await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId: projectRes.body.id, title: "Mine assigned", assigneeId: aliceId });
  await request(app).post("/api/issues").set(headers).send({ projectId: projectRes.body.id, title: "Unassigned" });

  const mineRes = await request(app).get("/api/issues?mine=1").set(headers);
  assert.equal(mineRes.statusCode, 200);
  assert.equal(mineRes.body.items.length, 1);
  assert.equal(mineRes.body.items[0].title, "Mine assigned");
  assert.equal(mineRes.body.pageInfo.total, 1);

  const allRes = await request(app).get("/api/issues").set(headers);
  assert.equal(allRes.statusCode, 200);
  assert.ok(allRes.body.items.length >= 2);
});

test("GET /api/issues/my-pending-work returns assigned todo+in_progress, oldest five, excludes done", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:bob-pend@example.com",
    "x-organization-id": "org-mine-pending"
  };

  const profileRes = await request(app).get("/api/profile").set(headers);
  assert.equal(profileRes.statusCode, 200);
  const userId = profileRes.body.id;

  const projectRes = await request(app).post("/api/projects").set(headers).send({ name: "Pend P", key: "PDG" });
  assert.equal(projectRes.statusCode, 201);
  const projectId = projectRes.body.id;

  for (let i = 0; i < 6; i += 1) {
    const r = await request(app)
      .post("/api/issues")
      .set(headers)
      .send({ projectId, title: `Oldest-${i}`, assigneeId: userId });
    assert.equal(r.statusCode, 201);
  }

  const mid = await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId, title: "In prog only", assigneeId: userId });
  assert.equal(mid.statusCode, 201);
  await request(app).patch(`/api/issues/${mid.body.id}/status`).set(headers).send({ status: "in_progress" });

  const doneOne = await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId, title: "Should exclude", assigneeId: userId });
  const doneId = doneOne.body.id;
  await request(app).patch(`/api/issues/${doneId}/status`).set(headers).send({ status: "in_progress" });
  await request(app).patch(`/api/issues/${doneId}/status`).set(headers).send({ status: "in_review" });
  await request(app).patch(`/api/issues/${doneId}/status`).set(headers).send({ status: "done" });

  const res = await request(app).get("/api/issues/my-pending-work").set(headers);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 7);
  assert.equal(res.body.items.length, 5);
  assert.deepEqual(
    res.body.items.map((x) => x.title),
    ["Oldest-0", "Oldest-1", "Oldest-2", "Oldest-3", "Oldest-4"]
  );
  assert.ok(res.body.items.every((x) => x.issues_id && x.status));
});
