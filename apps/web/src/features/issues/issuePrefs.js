import { apiGet, apiPut } from "../../api/client";

export function defaultIssueViewPrefs() {
  return {
    viewMode: "list",
    listGroupBy: "status",
    orderBy: "priority",
    orderDesc: false,
    showEmptyBoardColumns: false,
    stats: {
      measure: "issue_count",
      slice: "status",
      segment: "priority"
    },
    columns: {
      id: true,
      status: true,
      assignee: true,
      priority: true,
      project: true,
      cycle: true,
      estimate: true,
      labels: true,
      dueDate: true,
      created: false,
      updated: false
    }
  };
}

function prefsQuery(teamId) {
  const suffix = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  return `/api/issue-view-preferences${suffix}`;
}

/**
 * 从服务端读取（需已选工作区，请求头携带 X-Workspace-Id）
 */
export async function loadIssueViewPrefs(teamId, workspaceId) {
  const base = defaultIssueViewPrefs();
  if (!workspaceId) {
    return base;
  }
  try {
    const data = await apiGet(prefsQuery(teamId));
    const p = data?.prefs;
    if (!p || typeof p !== "object") {
      return base;
    }
    const merged = {
      ...base,
      ...p,
      columns: { ...base.columns, ...(p.columns || {}) }
    };
    /* 统计已与列表同页展示，不再使用独立 viewMode */
    if (merged.viewMode === "stats") {
      merged.viewMode = "list";
    }
    return merged;
  } catch {
    return base;
  }
}

export async function saveIssueViewPrefs(teamId, workspaceId, prefs) {
  if (!workspaceId || !prefs || typeof prefs !== "object") {
    return;
  }
  try {
    await apiPut(prefsQuery(teamId), prefs);
  } catch {
    // 忽略偏好同步失败，不影响主流程
  }
}

export function resetIssueViewPrefs() {
  return defaultIssueViewPrefs();
}
