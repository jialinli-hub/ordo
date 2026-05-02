# Issue 模块设计文档（V1）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Ordo 的 Issue 第一版核心能力，支持创建、删除及常用任务字段管理，覆盖接近 Linear 的基础工作流体验。

**Architecture:** Issue 作为 Team 下核心实体，创建与查询按 `organizationId + workspace/team/project` 约束，所有变更写入活动记录。前端在 Issue 列表区提供创建、删除、字段更新入口，优先保证 CRUD 与协作闭环。

**Tech Stack:** Node.js、Express、React、Vite、Vitest

---

## 1. 功能范围（V1）

必须实现：

1. 创建任务（Issue）
2. 删除任务
3. 更新状态与优先级
4. 更新指派人和标签
5. 更新截止时间、Cycle、Project 关联
6. 评论与活动记录
7. 工时字段（估算工时）
8. 任务类型（如 feature/bug/chore）

非目标：

- 子任务层级
- 通知订阅与提醒
- 复杂筛选 DSL

---

## 2. 领域模型（内存版）

Issue 字段（V1）：

- `id`
- `organizationId`
- `workspaceId`
- `teamId`
- `projectId`
- `cycleId?`
- `title`（必填）
- `description?`
- `status`（`todo | in_progress | in_review | done`）
- `priority`（`0..4`）
- `type`（`feature | bug | chore`）
- `estimateHours?`（number）
- `assigneeId?`
- `labels`（string[]）
- `dueDate?`（ISO date string）
- `issueNumber`
- `createdAt`, `updatedAt`
- `comments`（数组）
- `activity`（数组）

---

## 3. API 设计

## 3.1 创建 Issue

- `POST /api/issues`
- body 必填：
  - `projectId`
  - `teamId`
  - `title`
- body 可选：
  - `description, cycleId, priority, type, estimateHours, assigneeId, labels, dueDate`
- response: `201` 返回完整 issue

## 3.2 删除 Issue

- `DELETE /api/issues/:id`
- response: `200` -> `{ id, deleted: true }`

## 3.3 更新 Issue 字段

- `PATCH /api/issues/:id`
- 可更新字段：
  - `title, description, priority, type, estimateHours, assigneeId, labels, dueDate, projectId, cycleId, status`
- response: `200` 返回更新后 issue

## 3.4 评论

- `GET /api/issues/:id/comments`
- `POST /api/issues/:id/comments`
  - body: `body`（必填）
- response: `201` 返回 comment

## 3.5 活动记录

- `GET /api/issues/:id/activity`
- response: `200` -> `{ items: [...] }`

---

## 4. 权限与约束

- 所有接口必须登录
- Issue 必须属于当前 organization
- 变更操作要求当前用户具备 workspace 成员身份
- 删除不存在 issue 返回 `404`
- 参数错误返回 `400/422`

---

## 5. 前端交互

Issue 列表区增强：

- 创建表单：
  - 标题、类型、优先级、工时、标签、截止日期
- 列表项：
  - 显示标题、状态、优先级、类型、工时
  - 支持删除按钮
  - 支持状态快速更新
- 详情轻量面板（V1 可简化）：
  - 评论列表 + 新增评论

---

## 6. 测试策略

后端：

- 创建 issue 时字段写入正确
- 删除 issue 成功/不存在
- 更新字段成功
- 评论创建与查询
- 活动记录可查询且包含创建/更新/评论/删除事件

前端：

- 创建 issue 后列表出现
- 删除 issue 后列表移除
- 状态更新后 UI 同步
- 评论提交后显示

---

## 7. 验收标准（DoD）

- 可创建并删除 issue
- 可更新状态、优先级、指派、标签、截止时间、Cycle/Project、工时、任务类型
- 可新增评论并查看活动记录
- 测试通过，前后端可联调

