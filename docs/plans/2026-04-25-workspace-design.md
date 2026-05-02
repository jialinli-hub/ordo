# Workspace 模块设计文档（V1）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 Ordo 代码基础上优先落地 Workspace 能力，支持创建 Workspace、切换当前 Workspace、查看当前 Workspace 成员、邀请用户加入 Workspace，并确保后续 Team/Issue/Cycle/Project 的数据归属一致。

**Architecture:** 采用“Workspace 作为租户内一级容器”的领域建模，所有 Team 必须归属 Workspace，业务对象通过 Team 归属到 Workspace。后端提供 Workspace 与成员管理 API，前端在左上角提供 Workspace 切换器并驱动全局上下文，页面按当前 Workspace 过滤展示。

**Tech Stack:** Node.js、Express、Prisma、PostgreSQL、React、Vite、Vitest

---

## 1. 背景与范围

当前前端页面结构已经修正为 `workspace -> team -> issues/cycles/projects`，但数据仍是 mock。本阶段目标是先把 Workspace 层做实，为后续 Team 和业务对象的真实化提供基础。

本阶段仅包含以下 4 个功能：

1. 创建 Workspace  
2. 切换我所在的 Workspace  
3. 查看当前 Workspace 成员  
4. 邀请其他用户加入 Workspace

非目标（本阶段不做）：

- Team 的完整 CRUD
- Workspace 级高级权限（仅先做基础角色）

---

## 2. 领域模型与关系定义

## 2.1 核心关系（必须统一）

- 一个 Organization 下可有多个 Workspace
- 一个 Workspace 下可有多个 Team
- 一个 Team 下包含 Issues / Cycles / Projects
- 用户通过 `workspace_members` 成为 Workspace 成员

即：

`organization -> workspace -> team -> (issues, cycles, projects)`

## 2.2 数据表建议（Prisma 概念）

- `workspaces`
  - `id`
  - `organizationId`
  - `name`（组织内唯一）
  - `key`（可选，短标识，组织内唯一）
  - `createdBy`
  - `createdAt`, `updatedAt`
- `workspace_members`
  - `id`
  - `workspaceId`
  - `userId`
  - `role`（`owner | admin | member`）
  - `invitedBy`（可空）
  - `joinedAt`
  - unique: (`workspaceId`, `userId`)
- `workspace_invites`
  - `id`
  - `workspaceId`
  - `role`
  - `status`（`pending | accepted | revoked | expired`）
  - `token`（一次性 token，邀请链接使用）
  - `expiresAt`（固定为创建后 7 天）
  - `acceptedAt`（可空）
  - `invitedBy`
  - `createdAt`

后续 Team 表需增加：

- `team.workspaceId`（必填）

---

## 3. 权限策略（V1）

## 3.1 角色能力

- `owner/admin`
  - 创建 Workspace（是否开放给 admin 由产品配置，V1 可仅 owner）
  - 邀请成员
  - 查看成员列表
  - 切换到自己有权限的 Workspace
- `member`
  - 切换到自己有权限的 Workspace
  - 查看成员列表
  - 不可邀请

## 3.2 鉴权原则

- 所有 Workspace API 需要登录态 + organization 上下文
- 所有写操作必须校验当前用户在目标 Workspace 的角色
- 所有列表查询必须按“当前用户可访问的 Workspace”过滤

---

## 4. API 设计（V1）

以下路径仅示例，遵循现有 `/api` 风格：

## 4.1 创建 Workspace

- `POST /api/workspaces`
- body:
  - `name: string`（必填）
  - `key?: string`
- response: `201`
  - `id, name, key, organizationId, createdAt`
- 校验：
  - name 非空、长度限制、组织内唯一
  - key 如提供需组织内唯一

## 4.2 获取我可访问的 Workspace 列表（用于切换）

- `GET /api/workspaces/mine`
- response: `200`
  - `items: [{ id, name, key, role, memberCount }]`

## 4.3 切换当前 Workspace（会话态）

可选两种方式，建议先用方式 A：

- 方式 A（推荐，简单）：
  - 前端本地保存 `currentWorkspaceId`
  - 每次请求通过 Header 携带：`X-Workspace-Id`
  - 后端校验用户是否属于该 Workspace
- 方式 B（后续）：
  - `POST /api/workspaces/switch` 写服务端 session

## 4.4 获取当前 Workspace 成员

- `GET /api/workspaces/:workspaceId/members`
- response: `200`
  - `items: [{ userId, name, email, role, joinedAt }]`

## 4.5 生成 Workspace 邀请链接

- `POST /api/workspaces/:workspaceId/invites`
- body:
  - `role: owner|admin|member`（V1 可限制 `admin|member`）
- response: `201`
  - `inviteId, role, status, expiresAt, inviteLink`
- 规则：
  - 生成一次性邀请链接，由当前用户手动复制并线下发送
  - 链接 7 天有效，过期后不可使用

## 4.6 接受邀请（邀请链接）

- `GET /api/workspace-invites/accept?token=...`
- 行为：
  - token 合法且未过期：将用户加入 `workspace_members`，并将 invite 标记为 `accepted`
  - token 过期：返回 `410 Gone`（前端提示“邀请已过期，请重新邀请”）
  - token 无效/已撤销：返回 `404` 或 `409`（按实现约定）
- response: `302`（重定向到前端 Workspace 页面）或 `200`（前后端分离 JSON）

---

## 5. 前端交互设计（V1）

## 5.1 左上角 Workspace 切换器

- 打开应用时：
  - 请求 `GET /api/workspaces/mine`
  - 若本地无 `currentWorkspaceId`，默认使用列表第一项
- 用户切换 Workspace：
  - 更新 `currentWorkspaceId`
  - 刷新 Team 区域及主内容数据

## 5.2 当前 Workspace 成员展示

- 在 `Team settings` 页增加 “Workspace members” 区块
- 展示成员姓名/邮箱/角色/加入时间

## 5.3 邀请入口

- 在成员区块右上添加 `Invite member` 按钮
- 弹窗字段：`role`
- 提交成功后显示邀请链接（7 天内有效）
- 支持一键复制邀请链接
- 提交成功后刷新成员列表或 pending 邀请列表

---

## 6. 错误处理与边界场景

- `403`：用户无该 Workspace 权限
- `404`：Workspace 不存在或不可见
- `409`：重复创建、重复成员、重复邀请
- `422`：role/name 等字段格式不合法
- `410`：邀请链接已过期

关键边界：

- 用户被移出 Workspace 后，本地仍缓存该 `workspaceId`
  - 下次请求应收到 `403`，前端自动回退到可访问列表第一项
- 当前 Workspace 被删除（后续功能）
  - 前端同样回退
- 邀请链接过期（超过 7 天）
  - 接受页提示过期并提供“联系管理员重新邀请”

---

## 7. 测试策略（先测后改）

## 7.1 后端测试

- `POST /api/workspaces` 成功创建 + 重名失败
- `GET /api/workspaces/mine` 仅返回当前用户可访问集合
- `GET /api/workspaces/:id/members` 权限正确
- `POST /api/workspaces/:id/invites` 成功/重复/越权场景
- `POST /api/workspaces/:id/invites` 成功后返回 7 天有效邀请链接
- `GET /api/workspace-invites/accept` 的有效 token、过期 token、无效 token 场景
- `X-Workspace-Id` 越权访问被拒绝

## 7.2 前端测试

- 应用加载后展示 Workspace 切换器与默认选中项
- 切换 workspace 后，团队列表随之变化
- 邀请成功后列表更新
- 邀请成功提示“可复制邀请链接且 7 天有效”
- 通过邀请链接进入后可正确加入 workspace（可做 e2e）
- 无权限 workspace 自动回退

---

## 8. 分阶段实施建议

### Phase 1（本次）

1. 数据模型：`workspaces`、`workspace_members`、`workspace_invites`
2. API：创建、我的 workspace、成员列表、邀请、接受邀请
3. 前端：workspace 切换器接入真实接口

### Phase 2

1. Team 改造为强依赖 `workspaceId`
2. Issues/Cycles/Projects 查询统一按 `workspace -> team` 过滤
3. 邀请链接管理（重发、撤销、失效提醒）

---

## 9. 验收标准（DoD）

- 可以创建一个新 Workspace
- 用户可在左上角切换自己有权限的 Workspace
- 能看到当前 Workspace 成员列表
- 能生成当前 Workspace 的邀请链接（7 天有效）
- 受邀用户点击链接后可在有效期内加入 Workspace
- 所有接口具备基本权限校验与错误码
- 对应测试通过（后端 + 前端）

---

## 10. 关键实现决策（建议）

- 使用 Header `X-Workspace-Id` 作为当前 Workspace 上下文来源（V1）
- Workspace 切换优先做前端会话态，不引入服务端 session 切换接口
- 邀请采用“手动分享链接 + token”机制，链接有效期固定 7 天

