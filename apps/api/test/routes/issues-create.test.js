const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("POST /api/issues should assign incremental issueNumber by team identifier", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-issue"
  };

  const teamRes = await request(app)
    .post("/api/teams")
    .set(authHeaders)
    .send({ name: "Platform Team", identifier: "PLAT" });
  const teamId = teamRes.body.id;

  const projectResA = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Issue Project A", key: "ISA" });
  const projectResB = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Issue Project B", key: "ISB" });
  const projectIdA = projectResA.body.id;
  const projectIdB = projectResB.body.id;

  const first = await request(app)
    .post("/api/issues")
    .set(authHeaders)
    .send({ projectId: projectIdA, teamId, title: "First issue" });
  const second = await request(app)
    .post("/api/issues")
    .set(authHeaders)
    .send({ projectId: projectIdB, teamId, title: "Second issue" });

  assert.equal(teamRes.statusCode, 201);
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.body.identifier, "PLAT");
  assert.equal(second.body.identifier, "PLAT");
  assert.equal(first.body.issueNumber, 1);
  assert.equal(second.body.issueNumber, 2);
  /** 挂了带 identifier 的团队时 numbering 前缀用团队前缀 */
  assert.match(String(first.body.issues_id || ""), /^PLAT-1$/i);
  assert.match(String(second.body.issues_id || ""), /^PLAT-2$/i);
});
