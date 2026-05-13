/**
 * 任务详情短路径（根级，无工作区 slug）：`/issues/{issuesId}`。
 * @param {string} _workspacePathPrefix 保留参数以兼容旧调用，已忽略
 * @param {string} issuesId 可读任务键，如 COR-42
 */
export function issueDetailPath(_workspacePathPrefix, issuesId) {
  const raw = String(issuesId ?? "").trim();
  if (!raw) {
    return "/";
  }
  return `/issues/${encodeURIComponent(raw)}`;
}

/**
 * @param {string} workspacePathPrefix
 * @param {string} projectId UUID
 */
export function projectDetailPath(workspacePathPrefix, projectId) {
  const base = String(workspacePathPrefix || "").replace(/\/$/, "");
  const id = String(projectId ?? "").trim();
  if (!base || !id) {
    return base || "/";
  }
  return `${base}/projects/${encodeURIComponent(id)}`;
}

/** @param {string} innerPath stripWorkspacePrefix 之后的内层路径 */
export function parseWorkspaceRelativeIssuePath(innerPath) {
  const m = String(innerPath || "").match(/^\/issues\/([^/]+)$/);
  if (!m) {
    return null;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** @param {string} innerPath */
export function parseWorkspaceRelativeProjectPath(innerPath) {
  const m = String(innerPath || "").match(/^\/projects\/([^/]+)$/);
  if (!m) {
    return null;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
