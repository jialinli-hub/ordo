# Cycle 模块设计文档（V1）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 支持周期（Cycle）按时间窗口进行规划管理，提供周期创建与列表能力，并输出周期报表数据用于迭代复盘。

**Architecture:** Cycle 归属于 Project（间接归属 Team/Workspace），按 `organizationId` 做隔离。报表数据基于 `cycleId` 聚合 Issue 状态和工时字段，形成可直接展示的迭代指标。

**Tech Stack:** Node.js、Express、React、Vite、Vitest

---

## 1. 功能范围（V1）

1. 创建 Cycle（名称、开始时间、结束时间）
2. 查看 Cycle 列表
3. 查看单个 Cycle 报表

非目标：

- 自动排程优化
- 周期模板
- 跨周期趋势图

---

## 2. 数据模型

Cycle 字段：

- `id`
- `organizationId`
- `projectId`
- `name`
- `startsAt`
- `endsAt`
- `status`（`planned | active | closed`）
- `createdAt`

状态规则（V1）：

- `now < startsAt` -> `planned`
- `startsAt <= now <= endsAt` -> `active`
- `now > endsAt` -> `closed`

---

## 3. API 设计

- `POST /api/cycles`
  - body: `projectId`, `name`, `startsAt`, `endsAt`
  - 校验：`startsAt < endsAt`
- `GET /api/cycles`
  - 支持 `projectId` 可选过滤
- `GET /api/cycles/:id/report`
  - 返回报表：
    - `totalIssues`
    - `doneIssues`
    - `completionRate`
    - `byStatus`
    - `totalEstimateHours`
    - `doneEstimateHours`
    - `remainingEstimateHours`

---

## 4. 前端交互

Cycle 面板：

- 创建表单（名称、开始日期、结束日期）
- 周期列表
- 每个周期可展开查看报表摘要

---

## 5. 测试策略

后端：

- 创建 cycle 成功
- 时间非法（结束早于开始）返回 `422`
- 报表接口返回正确聚合

前端：

- 能创建 cycle 并更新列表
- 能读取并展示报表数据

---

## 6. 验收标准

- 可以创建并查看周期
- 周期报表可返回并展示关键指标
- 测试通过

