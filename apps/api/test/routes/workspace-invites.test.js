const { randomUUID } = require("node:crypto");
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

test("workspace invite should return shareable 7-day link and accept invite", async () => {
  const loginRes = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:owner@example.com" });

  assert.equal(loginRes.statusCode, 200);
  const auth = { Authorization: `Bearer ${loginRes.body.accessToken}` };
  const workspaceId = loginRes.body.workspace.id;

  const inviteRes = await request(app)
    .post(`/api/workspaces/${workspaceId}/invites`)
    .set(auth)
    .send({ role: "member" });

  assert.equal(inviteRes.statusCode, 201);
  assert.equal(inviteRes.body.status, "pending");
  assert.ok(inviteRes.body.expiresAt);
  const expiresAt = new Date(inviteRes.body.expiresAt);
  const createdAt = new Date(inviteRes.body.createdAt);
  const diffMs = expiresAt.getTime() - createdAt.getTime();
  assert.ok(diffMs >= 7 * 24 * 60 * 60 * 1000 - 1000);
  assert.ok(diffMs <= 7 * 24 * 60 * 60 * 1000 + 1000);

  assert.match(inviteRes.body.inviteLink, /accept-workspace-invite\?token=/);
  assert.ok(inviteRes.body.inviteLink.includes(inviteRes.body.token));

  const token = inviteRes.body.token;
  const acceptRes = await request(app)
    .get(`/api/workspace-invites/accept?token=${encodeURIComponent(token)}`)
    .set({ Authorization: "Bearer dev-dingtalk:member@example.com" });

  assert.equal(acceptRes.statusCode, 200);
  assert.equal(acceptRes.body.workspaceId, workspaceId);

  const membersRes = await request(app).get(`/api/workspaces/${workspaceId}/members`).set(auth);
  assert.equal(membersRes.statusCode, 200);
  assert.ok(membersRes.body.items.some((item) => item.email === "member@example.com"));

  const inviteRowAfter = await prisma.workspaceInvite.findUnique({ where: { token } });
  assert.equal(inviteRowAfter.status, "pending");

  const acceptMember2 = await request(app)
    .get(`/api/workspace-invites/accept?token=${encodeURIComponent(token)}`)
    .set({ Authorization: "Bearer dev-dingtalk:member2@example.com" });
  assert.equal(acceptMember2.statusCode, 200);

  const membersRes2 = await request(app).get(`/api/workspaces/${workspaceId}/members`).set(auth);
  assert.ok(membersRes2.body.items.some((item) => item.email === "member2@example.com"));

  const acceptAgainSameUser = await request(app)
    .get(`/api/workspace-invites/accept?token=${encodeURIComponent(token)}`)
    .set({ Authorization: "Bearer dev-dingtalk:member@example.com" });
  assert.equal(acceptAgainSameUser.statusCode, 200);

  const inviteRowFinal = await prisma.workspaceInvite.findUnique({ where: { token } });
  assert.equal(inviteRowFinal.status, "pending");
});

test("GET /api/workspace-invites/preview succeeds without Authorization", async () => {
  const loginRes = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:previewowner@example.com" });

  assert.equal(loginRes.statusCode, 200);
  const auth = { Authorization: `Bearer ${loginRes.body.accessToken}` };
  const workspaceId = loginRes.body.workspace.id;

  const teamRes = await request(app).post("/api/teams").set(auth).send({ name: "Preview Squad" });
  assert.equal(teamRes.statusCode, 201);
  const teamId = teamRes.body.id;

  const inviteRes = await request(app)
    .post(`/api/workspaces/${workspaceId}/invites`)
    .set(auth)
    .send({ role: "member", contextTeamId: teamId });

  assert.equal(inviteRes.statusCode, 201);
  assert.ok(String(inviteRes.body.inviteLink || "").includes("team="));
  const token = inviteRes.body.token;

  const previewRes = await request(app).get(`/api/workspace-invites/preview?token=${encodeURIComponent(token)}`);

  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.workspace?.id, workspaceId);
  assert.ok(previewRes.body.workspace?.name);
  assert.equal(previewRes.body.team?.id, teamId);
  assert.ok(previewRes.body.team?.name);
});

test("POST /api/workspaces/:workspaceId/invites rejects alien contextTeamId", async () => {
  const loginRes = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:alienctx@example.com" });

  assert.equal(loginRes.statusCode, 200);
  const auth = { Authorization: `Bearer ${loginRes.body.accessToken}` };
  const workspaceId = loginRes.body.workspace.id;

  const inviteRes = await request(app)
    .post(`/api/workspaces/${workspaceId}/invites`)
    .set(auth)
    .send({ role: "member", contextTeamId: randomUUID() });

  assert.equal(inviteRes.statusCode, 422);
});
