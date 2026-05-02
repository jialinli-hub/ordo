const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("POST /api/cycles should create cycle", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-cycle"
  };

  const projectRes = await request(app)
    .post("/api/projects")
    .set(headers)
    .send({ name: "Cycle Project", key: "CYC" });

  const cycleRes = await request(app)
    .post("/api/cycles")
    .set(headers)
    .send({
      projectId: projectRes.body.id,
      name: "Sprint 1",
      startsAt: "2026-04-01T00:00:00.000Z",
      endsAt: "2026-04-10T00:00:00.000Z"
    });

  assert.equal(cycleRes.statusCode, 201);
  assert.equal(cycleRes.body.name, "Sprint 1");
});

test("GET /api/cycles/:id/report should return aggregated cycle metrics", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-cycle-report"
  };

  const teamRes = await request(app).post("/api/teams").set(headers).send({ name: "Core Team" });
  const projectRes = await request(app)
    .post("/api/projects")
    .set(headers)
    .send({ name: "Cycle Report Project", key: "CRP" });
  const cycleRes = await request(app)
    .post("/api/cycles")
    .set(headers)
    .send({
      projectId: projectRes.body.id,
      name: "Sprint Report",
      startsAt: "2026-04-01T00:00:00.000Z",
      endsAt: "2026-04-10T00:00:00.000Z"
    });

  await request(app).post("/api/issues").set(headers).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    cycleId: cycleRes.body.id,
    title: "Done issue",
    status: "done",
    estimateHours: 5
  });
  await request(app).post("/api/issues").set(headers).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    cycleId: cycleRes.body.id,
    title: "Todo issue",
    status: "todo",
    estimateHours: 3
  });

  const reportRes = await request(app).get(`/api/cycles/${cycleRes.body.id}/report`).set(headers);
  assert.equal(reportRes.statusCode, 200);
  assert.equal(reportRes.body.totalIssues, 2);
  assert.equal(reportRes.body.doneIssues, 1);
  assert.equal(reportRes.body.totalEstimateHours, 8);
  assert.equal(reportRes.body.doneEstimateHours, 5);
});

test("GET /api/cycles should include per-cycle summary stats", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-cycle-list-stats"
  };

  const teamRes = await request(app).post("/api/teams").set(headers).send({ name: "Core Team" });
  const projectRes = await request(app)
    .post("/api/projects")
    .set(headers)
    .send({ name: "Cycle Stats Project", key: "CSP" });
  const cycleRes = await request(app)
    .post("/api/cycles")
    .set(headers)
    .send({
      projectId: projectRes.body.id,
      name: "Sprint Stats",
      startsAt: "2026-04-01T00:00:00.000Z",
      endsAt: "2026-04-10T00:00:00.000Z"
    });

  await request(app).post("/api/issues").set(headers).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    cycleId: cycleRes.body.id,
    title: "Done issue",
    status: "done",
    estimateHours: 5
  });
  await request(app).post("/api/issues").set(headers).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    cycleId: cycleRes.body.id,
    title: "Todo issue",
    status: "todo",
    estimateHours: 3
  });
  await request(app).post("/api/issues").set(headers).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    cycleId: cycleRes.body.id,
    title: "In progress issue",
    status: "in_progress",
    estimateHours: 2
  });

  const listRes = await request(app).get("/api/cycles").set(headers);
  assert.equal(listRes.statusCode, 200);
  const item = listRes.body.items.find((cycle) => cycle.id === cycleRes.body.id);
  assert.ok(item);
  assert.equal(item.summary.totalIssues, 3);
  assert.equal(item.summary.doneIssues, 1);
  assert.equal(item.summary.inProgressIssues, 1);
  assert.equal(item.summary.todoIssues, 1);
  assert.equal(item.summary.inReviewIssues, 0);
  assert.equal(item.summary.completionRate, 33.33);
  assert.equal(item.summary.scopeCount, 3);
  assert.deepEqual(item.summary.byStatus, { todo: 1, in_progress: 1, in_review: 0, done: 1 });
  assert.equal(item.summary.byType.feature, 3);
  assert.equal(item.summary.estimateHoursTotal, 10);
  assert.equal(item.summary.estimateHoursDone, 5);
  assert.equal(item.summary.estimateHoursRemaining, 5);
  assert.equal(item.summary.estimateUnset, 0);
});

test("POST /api/cycles should allow creating cycle for current team without project selection", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-cycle-team"
  };
  const teamARes = await request(app).post("/api/teams").set(headers).send({ name: "Team A" });
  const teamBRes = await request(app).post("/api/teams").set(headers).send({ name: "Team B" });

  const createRes = await request(app).post("/api/cycles").set(headers).send({
    teamId: teamARes.body.id,
    name: "Sprint Team A",
    startsAt: "2026-04-01T00:00:00.000Z",
    endsAt: "2026-04-10T00:00:00.000Z"
  });
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.teamId, teamARes.body.id);
  assert.equal(createRes.body.projectId, null);

  await request(app).post("/api/cycles").set(headers).send({
    teamId: teamBRes.body.id,
    name: "Sprint Team B",
    startsAt: "2026-04-01T00:00:00.000Z",
    endsAt: "2026-04-10T00:00:00.000Z"
  });

  const teamAListRes = await request(app)
    .get(`/api/cycles?teamId=${encodeURIComponent(teamARes.body.id)}`)
    .set(headers);
  assert.equal(teamAListRes.statusCode, 200);
  assert.equal(teamAListRes.body.items.length, 1);
  assert.equal(teamAListRes.body.items[0].teamId, teamARes.body.id);
});

test("POST /api/cycles should allow same-day cycle window", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-cycle-same-day"
  };

  const createRes = await request(app).post("/api/cycles").set(headers).send({
    name: "One day sprint",
    startsAt: "2026-04-01T00:00:00.000Z",
    endsAt: "2026-04-01T00:00:00.000Z"
  });
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.name, "One day sprint");
});
