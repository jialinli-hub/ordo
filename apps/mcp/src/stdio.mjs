/**
 * Ordo MCP（stdio）：所有 tools 通过 GraphQL POST 调用 apps/api 的 /api/graphql。
 *
 * 环境变量：
 * - ORDO_GRAPHQL_URL  默认 http://127.0.0.1:3000/api/graphql
 * - ORDO_ACCESS_TOKEN  Bearer（钉钉 dev id_token 或 OAuth client_credentials 换发的 JWT）
 * - ORDO_WORKSPACE_ID  可选；使用钉钉 token 时需与 REST 一致
 * - ORDO_ORGANIZATION_ID  可选，默认 org-dev
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { GraphQLClient, gql } from "graphql-request";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../api/.env") });
dotenv.config();

function createGql() {
  const url = process.env.ORDO_GRAPHQL_URL || "http://127.0.0.1:3000/api/graphql";
  const token = process.env.ORDO_ACCESS_TOKEN || "";
  if (!token) {
    throw new Error("缺少 ORDO_ACCESS_TOKEN（与 Ordo API 一致的 Bearer）");
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  const wid = process.env.ORDO_WORKSPACE_ID;
  if (wid) {
    headers["x-workspace-id"] = wid;
  }
  headers["x-organization-id"] = process.env.ORDO_ORGANIZATION_ID || "org-dev";
  return new GraphQLClient(url, { headers });
}

async function gqlJson(client, document, variables) {
  try {
    return await client.request(document, variables);
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e && "response" in e
          ? JSON.stringify(e.response)
          : String(e);
    throw new Error(msg);
  }
}

function wrapTool(run) {
  return async (args) => {
    try {
      const client = createGql();
      const data = await run(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }]
      };
    }
  };
}

const Q_USERS = gql`
  query OrdoWorkspaceUsers {
    workspaceUsers
  }
`;
const Q_TEAMS = gql`
  query OrdoTeams {
    teams
  }
`;
const Q_TEAM = gql`
  query OrdoTeam($teamId: ID!) {
    team(teamId: $teamId)
  }
`;
const M_TEAM_CREATE = gql`
  mutation OrdoTeamCreate($name: String!, $identifier: String) {
    teamCreate(name: $name, identifier: $identifier)
  }
`;
const M_TEAM_UPDATE = gql`
  mutation OrdoTeamUpdate($teamId: ID!, $patch: JSONObject!) {
    teamUpdate(teamId: $teamId, patch: $patch)
  }
`;
const M_TEAM_DELETE = gql`
  mutation OrdoTeamDelete($teamId: ID!) {
    teamDelete(teamId: $teamId)
  }
`;
const Q_CYCLES = gql`
  query OrdoCycles($projectId: ID, $teamId: ID) {
    cycles(projectId: $projectId, teamId: $teamId)
  }
`;
const Q_CYCLE = gql`
  query OrdoCycle($cycleId: ID!) {
    cycle(cycleId: $cycleId)
  }
`;
const M_CYCLE_CREATE = gql`
  mutation OrdoCycleCreate(
    $name: String!
    $startsAt: String!
    $endsAt: String!
    $projectId: ID
    $teamId: ID
    $kind: String
    $plannedTestAt: String
    $releaseAt: String
    $productDocUrl: String
    $designDocUrl: String
    $uiDocUrl: String
  ) {
    cycleCreate(
      name: $name
      startsAt: $startsAt
      endsAt: $endsAt
      projectId: $projectId
      teamId: $teamId
      kind: $kind
      plannedTestAt: $plannedTestAt
      releaseAt: $releaseAt
      productDocUrl: $productDocUrl
      designDocUrl: $designDocUrl
      uiDocUrl: $uiDocUrl
    )
  }
`;
const M_CYCLE_UPDATE = gql`
  mutation OrdoCycleUpdate($cycleId: ID!, $patch: JSONObject!) {
    cycleUpdate(cycleId: $cycleId, patch: $patch)
  }
`;
const M_CYCLE_DELETE = gql`
  mutation OrdoCycleDelete($cycleId: ID!) {
    cycleDelete(cycleId: $cycleId)
  }
`;
const Q_ISSUES = gql`
  query OrdoIssues($status: String, $teamId: ID, $page: Int, $pageSize: Int) {
    issues(status: $status, teamId: $teamId, page: $page, pageSize: $pageSize)
  }
`;
const Q_ISSUE = gql`
  query OrdoIssue($issueId: ID!) {
    issue(issueId: $issueId)
  }
`;
const M_ISSUE_CREATE = gql`
  mutation OrdoIssueCreate(
    $projectId: ID!
    $title: String!
    $teamId: ID
    $description: String
    $cycleId: ID
    $status: String
    $priority: Int
    $type: String
    $estimateHours: Float
    $assigneeId: ID
    $labels: [String!]
    $dueDate: String
  ) {
    issueCreate(
      projectId: $projectId
      title: $title
      teamId: $teamId
      description: $description
      cycleId: $cycleId
      status: $status
      priority: $priority
      type: $type
      estimateHours: $estimateHours
      assigneeId: $assigneeId
      labels: $labels
      dueDate: $dueDate
    )
  }
`;
const M_ISSUE_UPDATE = gql`
  mutation OrdoIssueUpdate($issueId: ID!, $patch: JSONObject!) {
    issueUpdate(issueId: $issueId, patch: $patch)
  }
`;
const M_ISSUE_DELETE = gql`
  mutation OrdoIssueDelete($issueId: ID!) {
    issueDelete(issueId: $issueId)
  }
`;

function buildServer() {
  const server = new McpServer({ name: "ordo-mcp", version: "1.0.0" }, { capabilities: {} });

  server.registerTool(
    "ordo_users_list",
    { description: "列出当前工作区成员（GraphQL workspaceUsers）", inputSchema: {} },
    wrapTool(async (client) => gqlJson(client, Q_USERS))
  );

  server.registerTool(
    "ordo_teams_list",
    { description: "列出团队（GraphQL teams）", inputSchema: {} },
    wrapTool(async (client) => gqlJson(client, Q_TEAMS))
  );

  server.registerTool(
    "ordo_teams_get",
    { description: "获取单个团队", inputSchema: { teamId: z.string() } },
    wrapTool(async (client, { teamId }) => gqlJson(client, Q_TEAM, { teamId }))
  );

  server.registerTool(
    "ordo_teams_create",
    {
      description: "创建团队",
      inputSchema: { name: z.string(), identifier: z.string().optional() }
    },
    wrapTool(async (client, args) => gqlJson(client, M_TEAM_CREATE, args))
  );

  server.registerTool(
    "ordo_teams_update",
    {
      description: "更新团队（patch 为 JSON 对象）",
      inputSchema: { teamId: z.string(), patch: z.record(z.string(), z.unknown()) }
    },
    wrapTool(async (client, { teamId, patch }) => gqlJson(client, M_TEAM_UPDATE, { teamId, patch }))
  );

  server.registerTool(
    "ordo_teams_delete",
    { description: "删除团队", inputSchema: { teamId: z.string() } },
    wrapTool(async (client, { teamId }) => gqlJson(client, M_TEAM_DELETE, { teamId }))
  );

  server.registerTool(
    "ordo_cycles_list",
    {
      description: "列出迭代",
      inputSchema: { projectId: z.string().optional(), teamId: z.string().optional() }
    },
    wrapTool(async (client, args) => gqlJson(client, Q_CYCLES, args))
  );

  server.registerTool(
    "ordo_cycles_get",
    { description: "获取单个迭代", inputSchema: { cycleId: z.string() } },
    wrapTool(async (client, { cycleId }) => gqlJson(client, Q_CYCLE, { cycleId }))
  );

  server.registerTool(
    "ordo_cycles_create",
    {
      description: "创建迭代",
      inputSchema: {
        name: z.string(),
        startsAt: z.string(),
        endsAt: z.string(),
        projectId: z.string().optional(),
        teamId: z.string().optional(),
        kind: z.string().optional(),
        plannedTestAt: z.string().optional(),
        releaseAt: z.string().optional(),
        productDocUrl: z.string().optional(),
        designDocUrl: z.string().optional(),
        uiDocUrl: z.string().optional()
      }
    },
    wrapTool(async (client, args) => gqlJson(client, M_CYCLE_CREATE, args))
  );

  server.registerTool(
    "ordo_cycles_update",
    {
      description: "更新迭代",
      inputSchema: { cycleId: z.string(), patch: z.record(z.string(), z.unknown()) }
    },
    wrapTool(async (client, { cycleId, patch }) => gqlJson(client, M_CYCLE_UPDATE, { cycleId, patch }))
  );

  server.registerTool(
    "ordo_cycles_delete",
    { description: "删除迭代", inputSchema: { cycleId: z.string() } },
    wrapTool(async (client, { cycleId }) => gqlJson(client, M_CYCLE_DELETE, { cycleId }))
  );

  server.registerTool(
    "ordo_issues_list",
    {
      description: "分页列任务",
      inputSchema: {
        status: z.string().optional(),
        teamId: z.string().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional()
      }
    },
    wrapTool(async (client, args) => gqlJson(client, Q_ISSUES, args))
  );

  server.registerTool(
    "ordo_issues_get",
    { description: "获取单个任务", inputSchema: { issueId: z.string() } },
    wrapTool(async (client, { issueId }) => gqlJson(client, Q_ISSUE, { issueId }))
  );

  server.registerTool(
    "ordo_issues_create",
    {
      description: "创建任务（需 projectId）",
      inputSchema: {
        projectId: z.string(),
        title: z.string(),
        teamId: z.string().optional(),
        description: z.string().optional(),
        cycleId: z.string().optional(),
        status: z.string().optional(),
        priority: z.number().optional(),
        type: z.string().optional(),
        estimateHours: z.number().optional(),
        assigneeId: z.string().optional(),
        labels: z.array(z.string()).optional(),
        dueDate: z.string().optional()
      }
    },
    wrapTool(async (client, args) => gqlJson(client, M_ISSUE_CREATE, args))
  );

  server.registerTool(
    "ordo_issues_update",
    {
      description: "更新任务",
      inputSchema: { issueId: z.string(), patch: z.record(z.string(), z.unknown()) }
    },
    wrapTool(async (client, { issueId, patch }) => gqlJson(client, M_ISSUE_UPDATE, { issueId, patch }))
  );

  server.registerTool(
    "ordo_issues_delete",
    { description: "删除任务", inputSchema: { issueId: z.string() } },
    wrapTool(async (client, { issueId }) => gqlJson(client, M_ISSUE_DELETE, { issueId }))
  );

  return server;
}

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
