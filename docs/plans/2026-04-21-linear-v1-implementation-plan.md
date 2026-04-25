# Ordo V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在当前 `apps/api + apps/web` 单仓统一部署架构下，完成 Ordo V1 的阶段化可执行计划，并优先交付 M1（可跑通一个 Cycle 的 P0 闭环）。

**Architecture:** 采用 Monorepo（npm workspaces）管理前后端，后端提供 `/api` 接口并托管前端构建产物；数据库以 Prisma + PostgreSQL 建模，按“组织 -> 项目 -> Cycle -> Issue”主链路推进。开发流程使用 TDD（先写失败测试，再最小实现），每个任务独立提交，确保可回滚、可验收。

**Tech Stack:** Node.js、Express（V1 基线）、Prisma、PostgreSQL、React、Vite、GitHub Actions

---

## 0. 约束与执行规则（所有任务适用）

- 必须遵守：@test-driven-development、DRY、YAGNI、频繁小提交。
- 每个任务都按 `RED -> GREEN -> REFACTOR -> COMMIT` 执行。
- API 前缀固定 `/api`；所有业务表必须包含 `organizationId`。
- 每个任务完成后，最少执行：
  - `npm run lint`
  - `npm run test`
  - `npm run build`

---

### [x] Task 1: 领域模型补全（Organization/Member/Project 权限基础）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_init_org_project_members/migration.sql`
- Test: `apps/api/test/schema/smoke-schema.test.js`

- [x] **Step 1: Write the failing test**

```js
test("schema should contain organization_members and project_members", async () => {
  const schema = await fs.readFile("apps/api/prisma/schema.prisma", "utf8");
  assert.match(schema, /model OrganizationMember/);
  assert.match(schema, /model ProjectMember/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/schema/smoke-schema.test.js`  
Expected: FAIL with `OrganizationMember` not found.

- [x] **Step 3: Write minimal implementation**

- 在 `schema.prisma` 增加：
  - `OrganizationMember`（`organizationId`、`userId`、`role`）
  - `ProjectMember`（`projectId`、`userId`、`role`）
- 增加必要唯一索引（如 `@@unique([organizationId, userId])`）。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/schema/smoke-schema.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/test/schema/smoke-schema.test.js
git commit -m "feat(api): add organization and project membership models"
```

---

### [x] Task 2: 鉴权与租户注入中间件（S0-04）

**Files:**
- Create: `apps/api/src/middleware/auth.js`
- Create: `apps/api/src/middleware/tenant.js`
- Modify: `apps/api/src/app.js`
- Test: `apps/api/test/auth/auth-middleware.test.js`

- [x] **Step 1: Write the failing test**

```js
test("missing authorization should return 401", async () => {
  const res = await request(app).get("/api/projects");
  assert.equal(res.statusCode, 401);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/auth/auth-middleware.test.js`  
Expected: FAIL with status `404` or `200`, not `401`.

- [x] **Step 3: Write minimal implementation**

- `auth.js`：读取 `Authorization: Bearer <token>`（V1 可先做假 token 解析）。
- `tenant.js`：从 token 注入 `req.context.organizationId`。
- 在 `app.js` 对 `/api/*` 应用中间件。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/auth/auth-middleware.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/middleware apps/api/src/app.js apps/api/test/auth/auth-middleware.test.js
git commit -m "feat(api): add auth and tenant context middleware"
```

---

### [x] Task 3: 组织与项目 API（S1-W2-01, S1-W2-02）

**Files:**
- Create: `apps/api/src/routes/organizations.js`
- Create: `apps/api/src/routes/projects.js`
- Modify: `apps/api/src/app.js`
- Create: `apps/api/src/repositories/projectRepository.js`
- Test: `apps/api/test/routes/projects.test.js`

- [x] **Step 1: Write the failing test**

```js
test("POST /api/projects should create project in organization", async () => {
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", "Bearer dev-token")
    .send({ name: "Core Platform", key: "CORE" });
  assert.equal(res.statusCode, 201);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/routes/projects.test.js`  
Expected: FAIL with route not found.

- [x] **Step 3: Write minimal implementation**

- 注册组织/项目路由。
- 支持项目创建、列表查询（按 `organizationId` 过滤）。
- 仅实现当前测试必需字段（YAGNI）。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/routes/projects.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes apps/api/src/repositories apps/api/src/app.js apps/api/test/routes/projects.test.js
git commit -m "feat(api): implement organization and project basic APIs"
```

---

### [x] Task 4: Issue CRUD + 防并发编号（S1-W3-01）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（新增 issue counter 表）
- Create: `apps/api/src/services/issueNumberService.js`
- Create: `apps/api/src/routes/issues.js`
- Modify: `apps/api/src/app.js`
- Test: `apps/api/test/routes/issues-create.test.js`

- [x] **Step 1: Write the failing test**

```js
test("POST /api/issues should assign incremental issueNumber per project", async () => {
  // 连续创建两条 issue，断言 issueNumber 为 1 和 2
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/routes/issues-create.test.js`  
Expected: FAIL with missing endpoint or wrong numbering.

- [x] **Step 3: Write minimal implementation**

- 新增计数器模型（如 `ProjectIssueCounter`）。
- 事务内读取并递增计数器，再写入 issue。
- 暴露 `POST /api/issues`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/routes/issues-create.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/src/services/issueNumberService.js apps/api/src/routes/issues.js apps/api/src/app.js apps/api/test/routes/issues-create.test.js
git commit -m "feat(api): add issue create API with per-project incremental numbering"
```

---

### [x] Task 5: Issue 状态机与合法流转（S1-W3-03）

**Files:**
- Create: `apps/api/src/domain/issueStateMachine.js`
- Create: `apps/api/src/routes/issueTransitions.js`
- Modify: `apps/api/src/app.js`
- Test: `apps/api/test/domain/issue-state-machine.test.js`
- Test: `apps/api/test/routes/issue-transition.test.js`

- [x] **Step 1: Write the failing test**

```js
test("state machine should reject invalid transition todo -> done directly", () => {
  assert.throws(() => transition("todo", "done"));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/domain/issue-state-machine.test.js`  
Expected: FAIL with function not defined.

- [x] **Step 3: Write minimal implementation**

- 定义允许流转：`todo -> in_progress -> in_review -> done`。
- 路由层调用状态机校验，非法流转返回 `400`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/domain/issue-state-machine.test.js apps/api/test/routes/issue-transition.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/domain/issueStateMachine.js apps/api/src/routes/issueTransitions.js apps/api/src/app.js apps/api/test/domain/issue-state-machine.test.js apps/api/test/routes/issue-transition.test.js
git commit -m "feat(api): enforce issue state transitions with state machine"
```

---

### [x] Task 6: Cycle CRUD + 自动开关基础任务（S1-W4-01）

**Files:**
- Create: `apps/api/src/routes/cycles.js`
- Create: `apps/api/src/jobs/cycleLifecycleJob.js`
- Modify: `apps/api/src/app.js`
- Test: `apps/api/test/routes/cycles.test.js`
- Test: `apps/api/test/jobs/cycle-lifecycle-job.test.js`

- [x] **Step 1: Write the failing test**

```js
test("cycle lifecycle job should close expired active cycles", async () => {
  // 构造过期 cycle，执行 job，断言状态变更
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/jobs/cycle-lifecycle-job.test.js`  
Expected: FAIL with module not found.

- [x] **Step 3: Write minimal implementation**

- 实现 Cycle 创建/列表接口。
- 实现最小 lifecycle job（先同步函数，后续再接队列）。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/routes/cycles.test.js apps/api/test/jobs/cycle-lifecycle-job.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/cycles.js apps/api/src/jobs/cycleLifecycleJob.js apps/api/src/app.js apps/api/test/routes/cycles.test.js apps/api/test/jobs/cycle-lifecycle-job.test.js
git commit -m "feat(api): add cycle APIs and lifecycle background job baseline"
```

---

### [x] Task 7: Issue 列表/看板查询接口（S1-W4-02, S1-W4-03）

**Files:**
- Create: `apps/api/src/routes/issueQuery.js`
- Create: `apps/api/src/services/issueQueryService.js`
- Modify: `apps/api/src/app.js`
- Test: `apps/api/test/routes/issue-query.test.js`

- [x] **Step 1: Write the failing test**

```js
test("GET /api/issues should support status filter and pagination", async () => {
  // 断言返回 items + pageInfo
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/test/routes/issue-query.test.js`  
Expected: FAIL with route not found.

- [x] **Step 3: Write minimal implementation**

- `GET /api/issues?status=&page=&pageSize=` 列表查询。
- `GET /api/issues/board` 按状态分组返回。
- 添加必要索引并记录慢查询风险。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/test/routes/issue-query.test.js`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/issueQuery.js apps/api/src/services/issueQueryService.js apps/api/src/app.js apps/api/test/routes/issue-query.test.js
git commit -m "feat(api): add issue list and board query endpoints"
```

---

### [x] Task 8: 前端最小工作台（组织/项目/Issue List）（S1-W2-04, S1-W4-04）

**Files:**
- Modify: `apps/web/src/App.jsx`
- Create: `apps/web/src/api/client.js`
- Create: `apps/web/src/features/projects/ProjectList.jsx`
- Create: `apps/web/src/features/issues/IssueList.jsx`
- Test: `apps/web/src/features/issues/IssueList.test.jsx`

- [x] **Step 1: Write the failing test**

```jsx
it("renders issue titles from api response", async () => {
  // mock fetch /api/issues
  // expect title shown
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/web`  
Expected: FAIL with missing component/test setup.

- [x] **Step 3: Write minimal implementation**

- 封装最小 API client（仅 GET）。
- 页面包含项目列表与 Issue 列表两块区域。
- 接口失败时显示基础错误提示。

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/web`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/api/client.js apps/web/src/features
git commit -m "feat(web): add minimal project and issue list workspace"
```

---

## 里程碑验收命令（M1）

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. 启动：`npm run start`
5. 手工验收：
   - `GET /api/health` 返回 `200`
   - 可创建项目、创建 Issue、状态流转、查询列表/看板
   - 前端可展示 Issue 列表

---

## 风险与前置决策

- 当前 V1 基线后端为 Express，若要切换 NestJS，建议在 M1 后单独立项迁移，避免与业务交付耦合。
- Windows 本地可能出现 workspace symlink 权限问题，开发机安装建议：`npm install --install-links=false`。
- 第三方集成（GitHub/GitLab）和规则引擎在 M1 后进入 M2，不提前引入复杂度（YAGNI）。

