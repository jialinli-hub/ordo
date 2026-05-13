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

test("requirements CRUD and convert creates project cycle only (no project)", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-req-pool"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Req Team" });
  assert.equal(teamRes.statusCode, 201);
  const teamId = teamRes.body.id;

  const createRes = await request(app).post("/api/requirements").set(authHeaders).send({
    title: "  支付改版  ",
    prdUrl: "https://wiki.example/prd/pay",
    otherFiles: [
      { purpose: "接口文档", url: "https://wiki.example/api" },
      { purpose: "", url: "https://figma.example/board" }
    ],
    status: "ready"
  });
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.title, "支付改版");
  assert.equal(createRes.body.status, "ready");
  assert.equal(createRes.body.prdUrl, "https://wiki.example/prd/pay");
  assert.equal(createRes.body.otherFiles.length, 2);
  assert.equal(createRes.body.otherFiles[1].purpose, "其他文件");
  const rid = createRes.body.id;

  const listRes = await request(app).get("/api/requirements").set(authHeaders);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.items.length, 1);

  const patchRes = await request(app)
    .patch(`/api/requirements/${encodeURIComponent(rid)}`)
    .set(authHeaders)
    .send({ status: "triaging" });
  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.body.status, "triaging");

  const convRes = await request(app)
    .post(`/api/requirements/${encodeURIComponent(rid)}/convert`)
    .set(authHeaders)
    .send({
      teamId,
      cycleName: "Sprint 1",
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-06-15T23:59:59.000Z"
    });
  assert.equal(convRes.statusCode, 201);
  assert.equal(convRes.body.project, undefined);
  assert.ok(convRes.body.cycle?.id);
  assert.equal(convRes.body.cycle.kind, "project");
  assert.equal(convRes.body.cycle.teamId, teamId);
  assert.equal(convRes.body.cycle.projectId, null);
  assert.equal(convRes.body.requirement.status, "converted");
  assert.equal(convRes.body.requirement.convertedTeamId, teamId);
  assert.equal(convRes.body.requirement.convertedProjectId, null);
  assert.equal(convRes.body.requirement.convertedCycleId, convRes.body.cycle.id);
  assert.equal(convRes.body.cycle.productDocUrl, "https://wiki.example/prd/pay");

  const cycleRow = await prisma.cycle.findUnique({ where: { id: convRes.body.cycle.id } });
  assert.ok(cycleRow);
  assert.equal(cycleRow.projectId, null);
  assert.equal(cycleRow.productDocUrl, "https://wiki.example/prd/pay");

  const patchAfter = await request(app)
    .patch(`/api/requirements/${encodeURIComponent(rid)}`)
    .set(authHeaders)
    .send({ title: "nope" });
  assert.equal(patchAfter.statusCode, 200);
  assert.equal(patchAfter.body.title, "nope");
  assert.equal(patchAfter.body.status, "converted");

  const demote = await request(app)
    .patch(`/api/requirements/${encodeURIComponent(rid)}`)
    .set(authHeaders)
    .send({ status: "draft" });
  assert.equal(demote.statusCode, 200);
  assert.equal(demote.body.status, "draft");
  assert.equal(demote.body.convertedCycleId, null);
  assert.equal(demote.body.convertedTeamId, null);
});

test("POST /api/requirements/:id/convert rejects duplicate convert", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-req-dup"
  };
  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "T2" });
  const teamId = teamRes.body.id;

  const createRes = await request(app).post("/api/requirements").set(authHeaders).send({ title: "Once" });
  const rid = createRes.body.id;

  const first = await request(app)
    .post(`/api/requirements/${encodeURIComponent(rid)}/convert`)
    .set(authHeaders)
    .send({
      teamId,
      cycleName: "C1",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-01-10T00:00:00.000Z"
    });
  assert.equal(first.statusCode, 201);

  const second = await request(app)
    .post(`/api/requirements/${encodeURIComponent(rid)}/convert`)
    .set(authHeaders)
    .send({
      teamId,
      cycleName: "C2",
      startsAt: "2026-02-01T00:00:00.000Z",
      endsAt: "2026-02-10T00:00:00.000Z"
    });
  assert.equal(second.statusCode, 409);
});
