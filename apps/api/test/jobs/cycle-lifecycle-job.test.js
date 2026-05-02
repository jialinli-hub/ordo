const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { prisma } = require("../../src/repositories/prisma");
const { resetDatabase } = require("../helpers/reset-database");
const { closeExpiredCycles } = require("../../src/jobs/cycleLifecycleJob");

beforeEach(async () => {
  await resetDatabase();
});

test("cycle lifecycle job should close expired active cycles", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-job"
  };

  const cycleRes = await request(app).post("/api/cycles").set(headers).send({
    name: "Expired Cycle",
    startsAt: "2026-06-01T00:00:00.000Z",
    endsAt: "2026-06-15T00:00:00.000Z"
  });
  assert.equal(cycleRes.statusCode, 201);

  await prisma.cycle.update({
    where: { id: cycleRes.body.id },
    data: { status: "active" }
  });

  await closeExpiredCycles(new Date("2026-07-01T00:00:00.000Z"));
  const row = await prisma.cycle.findUnique({ where: { id: cycleRes.body.id } });

  assert.equal(row.status, "closed");
});
