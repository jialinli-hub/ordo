const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { prisma } = require("../../src/repositories/prisma");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("issue management should support create update comments activity and delete", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-issue-mgmt"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Core Team" });
  assert.equal(teamRes.statusCode, 201);

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Issue Platform", key: "IP" });
  assert.equal(projectRes.statusCode, 201);

  const createRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    title: "Implement issue management",
    type: "feature",
    priority: 2,
    estimateHours: 6,
    labels: ["backend", "api"],
    dueDate: "2026-05-15",
    assigneeId: "user-1"
  });
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.type, "feature");
  assert.equal(createRes.body.priority, 2);
  assert.equal(createRes.body.estimateHours, 6);
  assert.deepEqual(createRes.body.labels, ["backend", "api"]);
  const issueId = createRes.body.id;

  const getRes = await request(app).get(`/api/issues/${issueId}`).set(authHeaders);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.title, "Implement issue management");
  assert.ok(Array.isArray(getRes.body.comments));
  assert.ok(Array.isArray(getRes.body.activity));

  const updateRes = await request(app).patch(`/api/issues/${issueId}`).set(authHeaders).send({
    status: "in_progress",
    priority: 1,
    type: "bug",
    estimateHours: 8
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.status, "in_progress");
  assert.equal(updateRes.body.priority, 1);
  assert.equal(updateRes.body.type, "bug");
  assert.equal(updateRes.body.estimateHours, 8);

  const commentRes = await request(app)
    .post(`/api/issues/${issueId}/comments`)
    .set(authHeaders)
    .send({ body: "Need to align API response shape." });
  assert.equal(commentRes.statusCode, 201);
  assert.equal(commentRes.body.body, "Need to align API response shape.");

  const commentsRes = await request(app).get(`/api/issues/${issueId}/comments`).set(authHeaders);
  assert.equal(commentsRes.statusCode, 200);
  assert.equal(commentsRes.body.items.length, 1);

  const activityRes = await request(app).get(`/api/issues/${issueId}/activity`).set(authHeaders);
  assert.equal(activityRes.statusCode, 200);
  assert.ok(activityRes.body.items.length >= 3);

  const deleteRes = await request(app).delete(`/api/issues/${issueId}`).set(authHeaders);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.deleted, true);

  const deleteAgainRes = await request(app).delete(`/api/issues/${issueId}`).set(authHeaders);
  assert.equal(deleteAgainRes.statusCode, 404);
});

test("parent issue can create one-level subtasks", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-issue-subtasks"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Sub Team" });
  assert.equal(teamRes.statusCode, 201);

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Sub Project", key: "SP" });
  assert.equal(projectRes.statusCode, 201);

  const parentRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    title: "Parent task"
  });
  assert.equal(parentRes.statusCode, 201);
  const parentId = parentRes.body.id;

  const childRes = await request(app).post("/api/issues").set(authHeaders).send({
    parentIssueId: parentId,
    title: "Subtask A"
  });
  assert.equal(childRes.statusCode, 201);
  assert.equal(childRes.body.parentIssueId, parentId);
  assert.equal(childRes.body.projectId, projectRes.body.id);

  const detailRes = await request(app).get(`/api/issues/${parentId}`).set(authHeaders);
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.body.subtasks.length, 1);
  assert.equal(detailRes.body.subtasks[0].title, "Subtask A");

  const childOfChild = await request(app).post("/api/issues").set(authHeaders).send({
    parentIssueId: childRes.body.id,
    title: "Should fail"
  });
  assert.equal(childOfChild.statusCode, 422);

  const listRes = await request(app)
    .get(`/api/issues?teamId=${encodeURIComponent(teamRes.body.id)}&pageSize=50`)
    .set(authHeaders);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.items.some((x) => x.id === childRes.body.id), false);
});

test("GET /api/issues/:id works when issue.workspaceId mismatches but team is in current workspace", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-ws-mismatch"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Mis Team" });
  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "P", key: "PM" });

  const createRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    title: "Stale workspace id on issue"
  });
  assert.equal(createRes.statusCode, 201);

  await prisma.issue.update({
    where: { id: createRes.body.id },
    data: { workspaceId: "wrong-workspace-id-record" }
  });

  const detail = await request(app).get(`/api/issues/${createRes.body.id}`).set(authHeaders);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.title, "Stale workspace id on issue");
});
