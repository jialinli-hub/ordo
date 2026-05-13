const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("issue attachments: upload, list on detail, download binary, delete", async () => {
  const headers = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-attach"
  };

  const projectRes = await request(app).post("/api/projects").set(headers).send({ name: "P", key: "AT" });
  assert.equal(projectRes.statusCode, 201);
  const issueRes = await request(app)
    .post("/api/issues")
    .set(headers)
    .send({ projectId: projectRes.body.id, title: "With files" });
  assert.equal(issueRes.statusCode, 201);
  const routeKey = issueRes.body.issues_id || issueRes.body.id;

  const bin = Buffer.from([1, 2, 3, 4, 5]);
  const up = await request(app)
    .post(`/api/issues/${encodeURIComponent(routeKey)}/attachments`)
    .set(headers)
    .send({
      fileName: "blob.bin",
      contentType: "application/octet-stream",
      dataBase64: bin.toString("base64")
    });
  assert.equal(up.statusCode, 201);
  assert.equal(up.body.fileName, "blob.bin");
  assert.equal(up.body.size, 5);
  const aid = up.body.id;

  const detail = await request(app).get(`/api/issues/${encodeURIComponent(routeKey)}`).set(headers);
  assert.equal(detail.statusCode, 200);
  assert.ok(Array.isArray(detail.body.attachments));
  assert.equal(detail.body.attachments.length, 1);
  assert.equal(detail.body.attachments[0].id, aid);

  const dl = await request(app)
    .get(`/api/issues/${encodeURIComponent(routeKey)}/attachments/${aid}`)
    .set(headers)
    .buffer(true);
  assert.equal(dl.statusCode, 200);
  assert.ok(Buffer.isBuffer(dl.body));
  assert.deepEqual([...dl.body], [...bin]);

  const del = await request(app)
    .delete(`/api/issues/${encodeURIComponent(routeKey)}/attachments/${aid}`)
    .set(headers);
  assert.equal(del.statusCode, 204);

  const detail2 = await request(app).get(`/api/issues/${encodeURIComponent(routeKey)}`).set(headers);
  assert.equal(detail2.statusCode, 200);
  assert.equal(detail2.body.attachments.length, 0);
});
