const { makeExecutableSchema } = require("@graphql-tools/schema");
const { GraphQLJSONObject } = require("graphql-type-json");
const { runOrdoMcpTool } = require("../services/ordoMcpToolRunner");

function ctxOrThrow(context) {
  const { userId, workspaceId, organizationId } = context;
  if (!userId || !workspaceId || !organizationId) {
    throw new Error("Missing tenant context (auth / X-Workspace-Id)");
  }
  return { userId, workspaceId, organizationId };
}

const typeDefs = /* GraphQL */ `
  scalar JSONObject

  type Query {
    """当前工作区成员及用户资料（等同 REST workspace members）"""
    workspaceUsers: JSONObject!
    teams: JSONObject!
    team(teamId: ID!): JSONObject!
    cycles(projectId: ID, teamId: ID): JSONObject!
    cycle(cycleId: ID!): JSONObject!
    issues(status: String, teamId: ID, page: Int, pageSize: Int): JSONObject!
    issue(issueId: ID!): JSONObject!
  }

  type Mutation {
    teamCreate(name: String!, identifier: String): JSONObject!
    teamUpdate(teamId: ID!, patch: JSONObject!): JSONObject!
    teamDelete(teamId: ID!): JSONObject!
    cycleCreate(
      name: String!
      startsAt: String!
      endsAt: String!
      projectId: ID
      teamId: ID
      kind: String
      plannedTestAt: String
      releaseAt: String
      productDocUrl: String
      designDocUrl: String
      uiDocUrl: String
    ): JSONObject!
    cycleUpdate(cycleId: ID!, patch: JSONObject!): JSONObject!
    cycleDelete(cycleId: ID!): JSONObject!
    issueCreate(
      projectId: ID!
      title: String!
      teamId: ID
      description: String
      cycleId: ID
      status: String
      priority: Int
      type: String
      estimateHours: Float
      assigneeId: ID
      labels: [String!]
      dueDate: String
    ): JSONObject!
    issueUpdate(issueId: ID!, patch: JSONObject!): JSONObject!
    issueDelete(issueId: ID!): JSONObject!
  }
`;

const resolvers = {
  JSONObject: GraphQLJSONObject,
  Query: {
    workspaceUsers(_p, _a, c) {
      return runOrdoMcpTool("ordo_users_list", {}, ctxOrThrow(c));
    },
    teams(_p, _a, c) {
      return runOrdoMcpTool("ordo_teams_list", {}, ctxOrThrow(c));
    },
    team(_p, { teamId }, c) {
      return runOrdoMcpTool("ordo_teams_get", { teamId }, ctxOrThrow(c));
    },
    cycles(_p, { projectId, teamId }, c) {
      return runOrdoMcpTool("ordo_cycles_list", { projectId, teamId }, ctxOrThrow(c));
    },
    cycle(_p, { cycleId }, c) {
      return runOrdoMcpTool("ordo_cycles_get", { cycleId }, ctxOrThrow(c));
    },
    issues(_p, { status, teamId, page, pageSize }, c) {
      return runOrdoMcpTool("ordo_issues_list", { status, teamId, page, pageSize }, ctxOrThrow(c));
    },
    issue(_p, { issueId }, c) {
      return runOrdoMcpTool("ordo_issues_get", { issueId }, ctxOrThrow(c));
    }
  },
  Mutation: {
    teamCreate(_p, { name, identifier }, c) {
      return runOrdoMcpTool("ordo_teams_create", { name, identifier }, ctxOrThrow(c));
    },
    teamUpdate(_p, { teamId, patch }, c) {
      return runOrdoMcpTool("ordo_teams_update", { teamId, patch }, ctxOrThrow(c));
    },
    teamDelete(_p, { teamId }, c) {
      return runOrdoMcpTool("ordo_teams_delete", { teamId }, ctxOrThrow(c));
    },
    cycleCreate(_p, args, c) {
      return runOrdoMcpTool("ordo_cycles_create", args, ctxOrThrow(c));
    },
    cycleUpdate(_p, { cycleId, patch }, c) {
      return runOrdoMcpTool("ordo_cycles_update", { cycleId, patch }, ctxOrThrow(c));
    },
    cycleDelete(_p, { cycleId }, c) {
      return runOrdoMcpTool("ordo_cycles_delete", { cycleId }, ctxOrThrow(c));
    },
    issueCreate(_p, args, c) {
      return runOrdoMcpTool("ordo_issues_create", args, ctxOrThrow(c));
    },
    issueUpdate(_p, { issueId, patch }, c) {
      return runOrdoMcpTool("ordo_issues_update", { issueId, patch }, ctxOrThrow(c));
    },
    issueDelete(_p, { issueId }, c) {
      return runOrdoMcpTool("ordo_issues_delete", { issueId }, ctxOrThrow(c));
    }
  }
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

module.exports = { schema };
