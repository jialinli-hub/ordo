const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { prisma } = require("../../src/repositories/prisma");
const { resetDatabase } = require("../helpers/reset-database");
const { ensureFutureTeamCycles } = require("../../src/jobs/autoCreateCyclesJob");

beforeEach(async () => {
  await resetDatabase();
});

test("auto create cycles job should create future cycles based on team settings", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:owner@example.com",
    "x-organization-id": "org-auto-cycle"
  };

  const teamRes = await request(app).post("/api/teams").set(headers).send({
    name: "Auto Cycle Team",
    identifier: "AUTO",
    iterationDurationDays: 14,
    cooldownDays: 2,
    iterationStartWeekday: 1
  });
  assert.equal(teamRes.statusCode, 201);

  const teamId = teamRes.body.id;
  const workspaceId = teamRes.body.workspaceId;

  const now = new Date("2026-05-08T12:00:00.000Z");
  const out = await ensureFutureTeamCycles({ now, targetCount: 1 });
  assert.ok(out.createdCount >= 1);

  const rows = await prisma.cycle.findMany({
    where: { workspaceId, teamId },
    orderBy: { startsAt: "asc" }
  });
  assert.ok(rows.every((c) => c.kind === "daily"));

  /** 至少 1 个 startsAt >= today 的日常迭代 */
  const today = new Date(Date.UTC(2026, 4, 8));
  const future = rows.filter((c) => {
    const s = new Date(Date.UTC(c.startsAt.getUTCFullYear(), c.startsAt.getUTCMonth(), c.startsAt.getUTCDate()));
    return s.getTime() >= today.getTime();
  });
  assert.ok(future.length >= 1);

  /** 第二次跑不应重复创建同一天 startsAt 的 cycle */
  const out2 = await ensureFutureTeamCycles({ now, targetCount: 1 });
  assert.equal(out2.createdCount, 0);
});

test("auto create cycles skips team when autoCreateDailyCycles is false", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:owner@example.com",
    "x-organization-id": "org-auto-cycle"
  };

  const teamRes = await request(app).post("/api/teams").set(headers).send({
    name: "No Auto Team",
    identifier: "NOA",
    iterationDurationDays: 14,
    cooldownDays: 2,
    iterationStartWeekday: 1
  });
  assert.equal(teamRes.statusCode, 201);

  const teamId = teamRes.body.id;
  const workspaceId = teamRes.body.workspaceId;

  const patchRes = await request(app)
    .patch(`/api/teams/${encodeURIComponent(teamId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
    .set(headers)
    .send({ autoCreateDailyCycles: false });
  assert.equal(patchRes.statusCode, 200);

  const now = new Date("2026-05-08T12:00:00.000Z");
  const out = await ensureFutureTeamCycles({ now, targetCount: 3 });
  assert.equal(out.createdCount, 0);

  const rows = await prisma.cycle.findMany({ where: { workspaceId, teamId } });
  assert.equal(rows.length, 0);
});

