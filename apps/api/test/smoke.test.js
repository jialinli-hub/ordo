const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");

test("GET /api/health should return ok when database is reachable", async () => {
  const response = await request(app).get("/api/health");
  if (!process.env.DATABASE_URL) {
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.database, "DATABASE_URL_not_configured");
    return;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.database, "postgresql_connected");
});
