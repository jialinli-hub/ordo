# Team 模块设计文档（V1）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 Workspace 能力基础上，落地 Team 的创建与删除能力，确保 Team 严格归属于当前 Workspace，并与 `issues/cycles/projects` 的层级关系一致。

**Architecture:** Team 作为 Workspace 的二级实体，所有 Team 操作都必须基于 `X-Workspace-Id` 上下文和成员权限校验。前端在 Team Settings 页面提供创建与删除入口，后端负责权限、唯一性和归属验证。

**Tech Stack:** Node.js、Express、React、Vite、Vitest

---

## 1. 范围

本阶段仅包含：

1. 创建 Team  
2. 删除 Team

非目标：

- Team 成员管理
- Team 权限细粒度配置
- Team 重命名

---

## 2. 领域关系

- `workspace -> teams -> (issues, cycles, projects)`
- Team 必须带 `workspaceId`
- 不允许跨 Workspace 操作 Team

---

## 3. API 设计

## 3.1 创建 Team

- `POST /api/teams`
- body:
  - `name: string`（必填）
  - `workspaceId?: string`（可选，不传则用当前上下文）
- response: `201`
  - `id, workspaceId, name`
- 校验：
  - name 非空
  - workspace 成员可创建（V1：`owner/admin/member` 均可）
  - 同 workspace 下 team 名称唯一（冲突返回 `409`）

## 3.2 删除 Team

- `DELETE /api/teams/:teamId`
- query:
  - `workspaceId?: string`（可选，不传则用当前上下文）
- response: `200`
  - `{ id, deleted: true }`
- 校验：
  - Team 必须存在于当前 workspace
  - 仅 `owner/admin` 可删除（V1）
  - 不存在时返回 `404`

---

## 4. 前端交互设计

在 `Team settings` 页面新增 Team 管理区块：

- 创建输入框 + 创建按钮
- Team 列表
- 每个 Team 旁边删除按钮（危险操作二次确认）

交互规则：

- 创建成功后刷新列表并显示成功提示
- 删除成功后从列表移除
- 重名创建显示冲突提示

---

## 5. 错误码约定

- `400`：参数错误（缺少 name）
- `403`：无权限
- `404`：team 不存在或不在当前 workspace
- `409`：team 名称重复

---

## 6. 测试策略

后端：

- 创建 team 成功
- 同名 team 冲突返回 `409`
- 删除 team 成功
- 无权限删除返回 `403`

前端：

- Team settings 能创建 team 并更新列表
- 删除按钮可删除 team 并更新列表
- 冲突错误文案展示正确

---

## 7. 验收标准（DoD）

- 可以在当前 workspace 创建 team
- 可以在当前 workspace 删除 team
- 删除后左侧 Team 列表同步更新
- API 权限与错误码符合预期
- 测试通过

