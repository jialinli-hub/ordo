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
