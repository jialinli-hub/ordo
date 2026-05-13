# GraphQL 接口清单

更新时间：2026-05-07

## 服务端

- **路径**：`POST /api/graphql`（GraphQL over HTTP，库 `graphql-http`）
- **认证**：与 REST 相同，请求头 `Authorization: Bearer …`（钉钉 dev token / OAuth JWT 等），租户头 `X-Workspace-Id`、`X-Organization-Id` 规则与 `tenant` 中间件一致。
- **实现**：`apps/api/src/graphql/schema.js`（SDL + resolvers），底层复用 `apps/api/src/services/ordoMcpToolRunner.js` 与 Prisma 的业务路径。

## 根类型摘要

标量：`JSONObject`（`graphql-type-json`）

| 类型 | 字段 | 说明 |
|------|------|------|
| Query | `workspaceUsers` | 当前工作区成员列表 |
| Query | `teams` | 团队列表 |
| Query | `team(teamId)` | 单个团队 |
| Query | `cycles(projectId?, teamId?)` | 迭代列表 |
| Query | `cycle(cycleId)` | 单个迭代 |
| Query | `issues(status?, teamId?, page?, pageSize?)` | 任务分页列表 |
| Query | `issue(issueId)` | 单个任务 |
| Mutation | `teamCreate` / `teamUpdate` / `teamDelete` | 团队增删改 |
| Mutation | `cycleCreate` / `cycleUpdate` / `cycleDelete` | 迭代增删改 |
| Mutation | `issueCreate` / `issueUpdate` / `issueDelete` | 任务增删改 |

完整 SDL 见 `apps/api/src/graphql/schema.js`。

## MCP 客户端

独立进程 **`apps/mcp`**（stdio）：各 tool 通过 `graphql-request` 调用上述 `ORDO_GRAPHQL_URL`，见 `apps/mcp/src/stdio.mjs`。
