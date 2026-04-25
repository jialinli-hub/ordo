const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("missing authorization should return 401", async () => {
  const res = await request(app).get("/api/projects");
  assert.equal(res.statusCode, 401);
});
