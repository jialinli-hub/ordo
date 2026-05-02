const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

test("dingtalk login should provide access to profile workspace and team APIs", async () => {
  const loginRes = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:alice@example.com" });

  assert.equal(loginRes.statusCode, 200);
  assert.ok(loginRes.body.accessToken);
  assert.ok(loginRes.body.workspace?.id);

  const auth = { Authorization: `Bearer ${loginRes.body.accessToken}` };

  const profileRes = await request(app).get("/api/profile").set(auth);
  assert.equal(profileRes.statusCode, 200);
  assert.equal(profileRes.body.email, "alice@example.com");

  const workspacesRes = await request(app).get("/api/workspaces").set(auth);
  assert.equal(workspacesRes.statusCode, 200);
  assert.ok(workspacesRes.body.items.length >= 1);

  const teamRes = await request(app)
    .post("/api/teams")
    .set(auth)
    .send({ name: "Platform Team" });
  assert.equal(teamRes.statusCode, 201);
  assert.ok(typeof teamRes.body.accentColor === "string");
  assert.match(teamRes.body.accentColor, /^#[0-9a-f]{6}$/i);

  const teamListRes = await request(app).get("/api/teams").set(auth);
  assert.equal(teamListRes.statusCode, 200);
  assert.ok(teamListRes.body.items.some((item) => item.name === "Platform Team"));

  const deleteRes = await request(app).delete(`/api/teams/${teamRes.body.id}`).set(auth);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.deleted, true);

  const teamListAfterDeleteRes = await request(app).get("/api/teams").set(auth);
  assert.equal(teamListAfterDeleteRes.statusCode, 200);
  assert.ok(teamListAfterDeleteRes.body.items.every((item) => item.id !== teamRes.body.id));
});
