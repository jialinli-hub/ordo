const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { resetDatabase } = require("../helpers/reset-database");

beforeEach(async () => {
  await resetDatabase();
});

test("GET /.well-known/oauth-authorization-server returns metadata", async () => {
  const res = await request(app).get("/.well-known/oauth-authorization-server");
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.token_endpoint);
  assert.ok(res.body.issuer);
  assert.ok((res.body.grant_types_supported || []).includes("client_credentials"));
});

test("POST /api/oauth/token client_credentials returns bearer token", async () => {
  process.env.ORDO_OAUTH_JWT_SECRET = "unit-test-jwt-secret-min-16-chars";
  const login = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:mcp-oauth-user@example.com" });
  assert.equal(login.statusCode, 200);
  const workspaceId = login.body.workspace.id;
  const userId = login.body.user.id;

  process.env.ORDO_OAUTH_CLIENTS_JSON = JSON.stringify([
    {
      clientId: "mcp-test-client",
      clientSecret: "mcp-test-secret",
      workspaceId,
      userId
    }
  ]);

  const tokenRes = await request(app)
    .post("/api/oauth/token")
    .type("form")
    .send({ grant_type: "client_credentials", client_id: "mcp-test-client", client_secret: "mcp-test-secret" });

  assert.equal(tokenRes.statusCode, 200);
  assert.ok(tokenRes.body.access_token);
  assert.equal(tokenRes.body.token_type, "Bearer");

  const profileOAuth = await request(app)
    .get("/api/profile")
    .set({ Authorization: `Bearer ${tokenRes.body.access_token}`, "x-organization-id": "org-dev" });
  assert.equal(profileOAuth.statusCode, 200);
  assert.equal(profileOAuth.body.id, userId);
});

test("POST /api/graphql workspaceUsers with OAuth bearer", async () => {
  process.env.ORDO_OAUTH_JWT_SECRET = "unit-test-jwt-secret-min-16-chars";
  const login = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:mcp-tools-user@example.com" });
  assert.equal(login.statusCode, 200);
  const workspaceId = login.body.workspace.id;
  const userId = login.body.user.id;
  process.env.ORDO_OAUTH_CLIENTS_JSON = JSON.stringify([
    {
      clientId: "mcp-tools-client",
      clientSecret: "mcp-tools-secret",
      workspaceId,
      userId
    }
  ]);
  const tokenRes = await request(app)
    .post("/api/oauth/token")
    .type("form")
    .send({ grant_type: "client_credentials", client_id: "mcp-tools-client", client_secret: "mcp-tools-secret" });
  assert.equal(tokenRes.statusCode, 200, tokenRes.text);
  const at = tokenRes.body.access_token;

  const gqlRes = await request(app)
    .post("/api/graphql")
    .set({ Authorization: `Bearer ${at}`, "x-organization-id": "org-dev" })
    .send({ query: "query { workspaceUsers }" });
  assert.equal(gqlRes.statusCode, 200, gqlRes.text);
  const body = gqlRes.body;
  assert.ok(body.data?.workspaceUsers?.items);
  assert.ok(Array.isArray(body.data.workspaceUsers.items));
});

test("POST /api/graphql issues list/create/update with OAuth bearer (same path as Ordo MCP)", async () => {
  process.env.ORDO_OAUTH_JWT_SECRET = "unit-test-jwt-secret-min-16-chars";
  const login = await request(app)
    .post("/api/auth/dingtalk")
    .send({ idToken: "dev-dingtalk:mcp-gql-issues@example.com" });
  assert.equal(login.statusCode, 200);
  const workspaceId = login.body.workspace.id;
  const userId = login.body.user.id;
  process.env.ORDO_OAUTH_CLIENTS_JSON = JSON.stringify([
    {
      clientId: "mcp-issues-client",
      clientSecret: "mcp-issues-secret",
      workspaceId,
      userId
    }
  ]);
  const tokenRes = await request(app)
    .post("/api/oauth/token")
    .type("form")
    .send({ grant_type: "client_credentials", client_id: "mcp-issues-client", client_secret: "mcp-issues-secret" });
  assert.equal(tokenRes.statusCode, 200, tokenRes.text);
  const at = tokenRes.body.access_token;
  const headers = { Authorization: `Bearer ${at}`, "x-organization-id": "org-dev" };

  const teamRes = await request(app).post("/api/teams").set(headers).send({ name: "MCP GraphQL Team" });
  assert.equal(teamRes.statusCode, 201, teamRes.text);
  const projectRes = await request(app)
    .post("/api/projects")
    .set(headers)
    .send({ name: "MCP GraphQL Project", key: "MG" });
  assert.equal(projectRes.statusCode, 201, projectRes.text);
  const projectId = projectRes.body.id;
  const teamId = teamRes.body.id;

  const createGql = await request(app)
    .post("/api/graphql")
    .set(headers)
    .send({
      query: `mutation {
        issueCreate(projectId: "${projectId}", teamId: "${teamId}", title: "MCP 创建任务测试", status: "todo")
      }`
    });
  assert.equal(createGql.statusCode, 200, createGql.text);
  assert.ok(!createGql.body.errors, JSON.stringify(createGql.body.errors));
  const issueId = createGql.body.data.issueCreate.id;
  assert.ok(issueId);
  assert.equal(createGql.body.data.issueCreate.title, "MCP 创建任务测试");

  const listGql = await request(app)
    .post("/api/graphql")
    .set(headers)
    .send({ query: "query { issues(page: 1, pageSize: 50) }" });
  assert.equal(listGql.statusCode, 200, listGql.text);
  assert.ok(!listGql.body.errors, JSON.stringify(listGql.body.errors));
  const { items, pageInfo } = listGql.body.data.issues;
  assert.ok(Array.isArray(items));
  assert.ok(items.some((i) => i.id === issueId));
  assert.equal(pageInfo.page, 1);
  assert.ok(pageInfo.total >= 1);

  const updateGql = await request(app)
    .post("/api/graphql")
    .set(headers)
    .send({
      query: `mutation IssueUp($issueId: ID!, $patch: JSONObject!) {
        issueUpdate(issueId: $issueId, patch: $patch)
      }`,
      variables: {
        issueId,
        patch: { title: "MCP 已修改标题", status: "in_progress" }
      }
    });
  assert.equal(updateGql.statusCode, 200, updateGql.text);
  assert.ok(!updateGql.body.errors, JSON.stringify(updateGql.body.errors));
  assert.equal(updateGql.body.data.issueUpdate.title, "MCP 已修改标题");
  assert.equal(updateGql.body.data.issueUpdate.status, "in_progress");
});
