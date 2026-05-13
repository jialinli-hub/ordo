# GitLab Workflow Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan.

**Goal:** 在 Team Settings 中新增 “Workflow” 配置页，接收 GitLab Webhook 后从分支名/MR 标题/描述/commit message 提取任务ID（如 `COR-42`），并按规则自动更新对应任务的状态（支持按目标分支覆盖规则）。

**Architecture:** Team 维度保存一份 `workflowAutomationsJson` 配置。后端提供无登录的 GitLab Webhook 入口（使用 `X-Gitlab-Token` 验证 secret），解析事件 → 识别触发器 → 按“默认规则 + 分支覆盖规则”选出目标状态 → 查找匹配任务并执行状态迁移（必要时按状态机逐步推进）。

**Tech Stack:** Node.js + Express, Prisma/Postgres, SolidJS（`apps/web`）。

---

### Task 1: 数据结构与迁移（Team.workflowAutomationsJson）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260506xxxxxx_gitlab_workflow_automation/migration.sql`

**Step 1: 添加 Team 字段**
- 在 Prisma `Team` 模型中新增 `workflowAutomationsJson Json?`

**Step 2: 增加 SQL migration**
- `ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "workflowAutomationsJson" JSONB;`

**Step 3: 生成/部署迁移**
- 本仓库采用手写 SQL migration，保证本地 `db:migrate:dev` 可应用。

---

### Task 2: Teams API 扩展（读写 workflow 配置）

**Files:**
- Modify: `apps/api/src/routes/teams.js`

**Step 1: mapTeamRow 输出 workflowAutomations**
- GET `/api/teams/:teamId` 返回 `workflowAutomations`（缺省时返回合理默认结构）

**Step 2: PATCH 支持更新 workflowAutomations**
- 允许写入 `workflowAutomations`（存入 `workflowAutomationsJson`）
- 做最小校验：结构为 object；secret 字符串长度限制；分支 regex 可编译；status 值限定在 `todo|in_progress|in_review|done`

---

### Task 3: GitLab Webhook 接口（无登录）

**Files:**
- Create: `apps/api/src/routes/gitlabWebhook.js`
- Modify: `apps/api/src/app.js`
- Modify: `apps/api/src/domain/issueStateMachine.js`（如需支持“逐步推进”）

**Step 1: 路由挂载与鉴权绕过**
- 在 `app.js` 中将 `/api/integrations/gitlab/webhook/:teamId` 挂载在 auth middleware 之前（因为 GitLab 无 JWT）

**Step 2: 验证 webhook secret**
- Header `X-Gitlab-Token` 必须匹配 Team 配置中的 secret

**Step 3: 事件解析与触发器归一**
- 支持 `merge_request` 与 `push`（可选 `note`）
- 触发器集合：
  - `onDraftOpen`
  - `onPrOpen`
  - `onPrActivity`
  - `onReadyForMerge`
  - `onMerge`

**Step 4: 提取任务ID（多来源按优先级）**
- 来源：分支名、MR 标题、MR 描述、commit message
- 正则：`/[A-Za-z][A-Za-z0-9_-]*-\\d+/g`，并复用 `isIssuesIdUrlParam` 做二次过滤

**Step 5: 分支覆盖规则**
- 基于目标分支（MR 的 `target_branch` 或 push 的 `ref`）匹配 `targetBranchRegex`

**Step 6: 更新 Issue 状态**
- 在 `workspaceId = team.workspaceId` 中按 `issuesId` 查找 Issue
- 走状态机：如从 `todo` 目标是 `done`，则逐步 `todo→in_progress→in_review→done`
- 记录 `IssueActivity`：`type="workflow_automation"`，payload 附带 GitLab 事件信息与触发器

---

### Task 4: Team Settings UI（Workflow tab）

**Files:**
- Modify: `apps/web/src/features/teams/TeamSettings.jsx`

**Step 1: 新增 Tab**
- 增加 `Workflow` tab

**Step 2: 配置项**
- enable 开关
- webhook secret 输入框（并提示 GitLab Webhook 要填的 URL 与 header）
- 默认规则：每个触发器对应一个状态下拉
- 分支规则列表：`targetBranchRegex` +（可选覆盖触发器→状态），支持增删

**Step 3: 保存**
- 调用既有 `persist()`，PATCH `/api/teams/:id` 写入 `workflowAutomations`

---

### Task 5: 测试与验证

**Files:**
- Create: `apps/api/test/routes/gitlab-webhook.test.js`

**Step 1: 单测**
- 构造一个 merge_request webhook payload（标题包含 `COR-1`）
- 预置 team/workspace/issue 数据
- 打 webhook endpoint，断言 Issue 状态按规则变化

**Step 2: 仅运行该测试文件**
- `node --require ./test/load-env.js --test test/routes/gitlab-webhook.test.js`

