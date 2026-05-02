# Project 模块设计文档（V1）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 落地 Project 的增删改查能力，支持在当前组织/工作空间内管理项目基础信息，并为 Issue 关联提供稳定的项目数据源。

**Architecture:** Project 作为组织下业务实体，接口按 `organizationId` 隔离；前端提供 Project 管理面板完成创建、查询、编辑、删除闭环。V1 优先实现基础字段与唯一键约束，不引入复杂权限矩阵。

**Tech Stack:** Node.js、Express、React、Vite、Vitest

---

## 1. 功能范围

必须实现：

1. 创建 Project
2. 查询 Project 列表
3. 查询单个 Project
4. 更新 Project（名称/Key）
5. 删除 Project

非目标：

- Project 成员管理
- Project 生命周期（planned/active/completed）
- Project 健康度算法

---

## 2. 数据模型（V1）

Project 字段：

- `id`
- `organizationId`
- `name`（必填）
- `key`（必填，组织内唯一）
- `createdAt`
- `updatedAt`

---

## 3. API 设计

- `POST /api/projects`
  - body: `name`, `key`
  - response: `201` + project

- `GET /api/projects`
  - response: `200` + `{ items: Project[] }`

- `GET /api/projects/:id`
  - response: `200` + project
  - 不存在：`404`

- `PATCH /api/projects/:id`
  - body: `name?`, `key?`
  - 至少提供一个字段
  - `key` 冲突：`409`

- `DELETE /api/projects/:id`
  - response: `200` + `{ id, deleted: true }`
  - 不存在：`404`

---

## 4. 前端交互设计

Project 管理面板（可放置在首页）：

- 创建区：名称 + key
- 列表区：显示已有项目
- 每行操作：
  - 编辑（name/key）
  - 删除

交互约束：

- 创建成功后即时刷新或本地插入
- 编辑成功后局部更新
- 删除成功后移除该行
- 冲突错误（409）给出用户可读提示

---

## 5. 错误码约定

- `400`：参数缺失（name/key 或 patch body 为空）
- `404`：项目不存在
- `409`：project key 冲突

---

## 6. 测试策略

后端：

- create/list/get/update/delete 全流程
- key 冲突场景
- 删除后再查询返回 404

前端：

- 创建项目后列表更新
- 编辑项目后内容更新
- 删除项目后列表移除

---

## 7. 验收标准（DoD）

- Project CRUD 接口可用
- 前端可完整执行增删改查
- 错误提示明确
- 测试通过

