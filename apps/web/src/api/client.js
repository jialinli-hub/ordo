function getAuthHeaders() {
  const token = localStorage.getItem("ordo_access_token");
  const workspaceId = localStorage.getItem("ordo_current_workspace_id");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
  };
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

function buildUrl(path) {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

function htmlResponseDevHint() {
  if (typeof import.meta.env === "undefined" || !import.meta.env?.DEV) {
    return "";
  }
  const baseShown = API_BASE_URL ? `${API_BASE_URL}` : "未设置（相对路径 /api，经 Vite 代理）";
  return [
    "收到 HTML（多为未命中 JSON API）：",
    "1）仓库根目录执行 npm run dev:all，或另开终端执行 npm run dev -w apps/api；",
    "2）不要把 VITE_API_BASE_URL 指向前端的 Vite 端口；本地优先留空使用代理；",
    `3）当前 VITE_API_BASE_URL=${baseShown}；代理目标可用 apps/web/.env 里的 VITE_DEV_PROXY_API（默认 127.0.0.1:3000）。`
  ].join("");
}

/** 兼容仅 mock 了 `json()` 的 Vitest fetch；运行时真实 Response 带 `text()`，可识别 HTML 误响应 */
async function readJsonBody(response) {
  if (typeof response.text === "function") {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      const t = text.trimStart();
      const html =
        t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<HTML");
      const hint = html ? `${htmlResponseDevHint()} （亦常见于未代理 /api 或未启动后端。）` : "";
      throw new Error(`无效 JSON 响应。${hint}`.trim());
    }
  }
  if (typeof response.json === "function") {
    return response.json();
  }
  throw new Error("无效的 API 响应");
}

async function readOptionalJsonMessage(response) {
  try {
    if (typeof response.text === "function") {
      return JSON.parse(await response.text())?.message;
    }
    if (typeof response.json === "function") {
      return (await response.json())?.message;
    }
  } catch {
    // ignore non-json body
  }
  return undefined;
}

async function request(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    const fromBody = await readOptionalJsonMessage(response);
    if (fromBody) {
      message = fromBody;
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return readJsonBody(response);
}

export async function apiGet(path) {
  return request(path);
}

export async function apiPost(path, body) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function apiDelete(path) {
  return request(path, {
    method: "DELETE"
  });
}

export async function apiPatch(path, body) {
  return request(path, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export async function apiPut(path, body) {
  return request(path, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}
