# Node + React 同项目统一部署方案

## 1. 目标

在一个项目中同时维护 Node 后端和 React 前端，并统一构建、统一部署、统一域名访问。  
该方案适用于当前阶段快速交付，降低部署复杂度与运维成本。

## 2. 推荐目录结构

```text
ordo/
  apps/
    api/                 # Node/Nest/Express 后端
    web/                 # React 前端
  package.json           # 根脚本（可选 workspace）
  Dockerfile             # 单镜像部署
  docs/
```

如果不使用 `apps`，也可使用 `server/` + `client/`，原则一致。

## 3. 统一部署原理

1. React 执行构建，生成静态文件（`dist` 或 `build`）。
2. Node 服务启动时托管静态目录。
3. API 使用统一前缀（建议 `/api`），其余路径回退到前端入口文件。

这样可做到：

- 同域名同端口访问，避免前后端跨域问题。
- 一次构建、一次发布、一次回滚。
- 适合中小团队快速迭代。

## 4. 后端静态托管示例（Express）

```js
const path = require("path");
const express = require("express");

const app = express();
const webDist = path.join(__dirname, "../web/dist");

app.use("/api", require("./routes"));
app.use(express.static(webDist));
app.get("*", (_, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

app.listen(process.env.PORT || 3000);
```

说明：

- `/api` 路由给后端接口。
- 非 `/api` 请求交由 React 路由处理。

## 5. 构建与运行脚本建议

根目录 `package.json` 可定义：

- `build:web`：构建 React
- `build:api`：构建 Node（如 TS 编译）
- `build`：先后执行 `build:web` 与 `build:api`
- `start`：启动 Node 服务（并托管前端静态文件）

示例流程：

1. `npm run build`
2. `npm run start`

## 6. Docker 单镜像部署建议

采用多阶段构建：

- 第一阶段安装依赖并构建前后端产物。
- 第二阶段仅拷贝运行所需文件，减小镜像体积。

运行后通过一个容器同时提供：

- `GET /api/*` 后端能力
- `GET /*` 前端静态页面

## 7. Nginx（可选）

如果线上采用 Nginx 反向代理，建议：

- `/api` 转发到 Node。
- `/` 访问 Node 托管的前端静态资源或直接由 Nginx 托管 `dist`。

推荐在早期保持简单：先由 Node 统一托管，减少配置面。

## 8. 环境变量约定

- `PORT`：Node 服务端口。
- `NODE_ENV`：运行环境。
- `DATABASE_URL`：数据库连接。
- `REDIS_URL`：队列与缓存。
- `WEB_BASE_URL`：前端基础地址（用于通知链接）。

## 9. 发布流程建议

1. 合并主分支后触发 CI。
2. 执行测试与构建。
3. 生成镜像并推送仓库。
4. 在 staging 部署验证。
5. 灰度发布到 production。
6. 如异常，回滚到上一镜像标签。

## 10. 适用边界与后续演进

该方案适合 V1 到 V2 阶段。  
当流量上升或团队拆分后，可演进为前后端独立部署：

- 前端静态资源迁移到 CDN。
- API 服务独立扩缩容。
- 网关层统一鉴权与路由。
