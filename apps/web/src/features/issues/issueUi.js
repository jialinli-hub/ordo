export const STATUS_META = {
  todo: { label: "Todo", dot: "#94a3b8" },
  in_progress: { label: "进行中", dot: "#ca8a04" },
  in_review: { label: "评审中", dot: "#16a34a" },
  done: { label: "已完成", dot: "#a8a29e" }
};

export const PRIORITY_META = {
  0: "无",
  1: "紧急",
  2: "高",
  3: "中",
  4: "低"
};

export const GROUP_ORDER = ["todo", "in_progress", "in_review", "done"];

export const TYPE_LABEL = {
  feature: "Feature",
  bug: "Bug",
  chore: "task"
};

/** IssueList 筛选用，与后端 type 对齐 */
export const TYPE_FILTER_OPTIONS = [
  { value: "feature", label: TYPE_LABEL.feature },
  { value: "bug", label: TYPE_LABEL.bug },
  { value: "chore", label: TYPE_LABEL.chore }
];

export function issueIdentifier(issue, project) {
  if (!issue || issue.issueNumber == null) {
    return "";
  }
  const prefix = issue.identifier || project?.key;
  if (!prefix) {
    return "";
  }
  return `${prefix}-${issue.issueNumber}`;
}

/** 展示与路由主键：`issues_id` 优先（与后端 issueDto 对齐） */
export function issueDisplayRef(issue, project) {
  if (!issue) {
    return "";
  }
  if (issue.issues_id) {
    return String(issue.issues_id);
  }
  return issueIdentifier(issue, project) || issue.id || "";
}

export function routeIssueSegment(issue, project) {
  const ref = issueDisplayRef(issue, project ?? null);
  return encodeURIComponent(ref || "");
}

export function typeTagClass(type) {
  if (type === "bug") {
    return "issue-type-tag bug";
  }
  if (type === "feature") {
    return "issue-type-tag feature";
  }
  return "issue-type-tag chore";
}
