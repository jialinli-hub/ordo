const { isIssuesIdUrlParam } = require("../utils/issuesId");
const { transitionIssueStatus } = require("../domain/issueStateMachine");

/**
 * 从任意文本中抓取 `PREFIX-数字` 形态的任务键（如 `TREX-123`）。
 * 适用于 MR 标题/描述、分支名，以及 **Push 里每条 commit 的 message**。
 * 常见写法：GitLab / 团队约定在提交说明里写 `Ref TREX-123`，同样会匹配到 `TREX-123` 并与该任务关联。
 */
function extractIssuesIdsFromText(text) {
  const s = String(text || "");
  if (!s) {
    return [];
  }
  const hits = s.match(/[A-Za-z][A-Za-z0-9_-]*-\d+/g) || [];
  const out = [];
  for (const raw of hits) {
    const id = String(raw).trim().toUpperCase();
    if (isIssuesIdUrlParam(id)) {
      out.push(id);
    }
  }
  return out;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function normalizeGitlabTrigger(payload, gitlabEvent) {
  const kind = payload?.object_kind || payload?.event_type || "";
  if (kind === "merge_request") {
    const attrs = payload.object_attributes || {};
    const action = String(attrs.action || "").toLowerCase();
    const state = String(attrs.state || "").toLowerCase();
    const draft = Boolean(attrs.draft) || Boolean(attrs.work_in_progress);
    if (state === "merged" || action === "merge") {
      return "onMerge";
    }
    if (draft && (action === "open" || action === "reopen" || action === "update")) {
      return "onDraftOpen";
    }
    if (action === "open" || action === "reopen") {
      return "onPrOpen";
    }
    if (action === "approved") {
      return "onReadyForMerge";
    }
    return "onPrActivity";
  }
  if (kind === "note") {
    const noteable = String(payload?.object_attributes?.noteable_type || "");
    if (noteable.toLowerCase() === "mergerequest") {
      return "onPrActivity";
    }
  }
  if (kind === "push" || String(gitlabEvent || "").toLowerCase() === "push hook") {
    return "onPrActivity";
  }
  return null;
}

function pickTargetBranch(payload) {
  const kind = payload?.object_kind || payload?.event_type || "";
  if (kind === "merge_request") {
    return payload?.object_attributes?.target_branch || "";
  }
  if (kind === "push") {
    const ref = String(payload?.ref || "");
    return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  }
  return "";
}

function selectRulesForBranch(defaultRules, branchRules, targetBranch) {
  const tb = String(targetBranch || "");
  if (!tb) {
    return defaultRules || {};
  }
  const list = Array.isArray(branchRules) ? branchRules : [];
  for (const row of list) {
    const rx = row?.targetBranchRegex;
    if (!rx) continue;
    try {
      const re = new RegExp(String(rx));
      if (re.test(tb)) {
        return { ...(defaultRules || {}), ...(row.rules || {}) };
      }
    } catch {
      // invalid regex is validated on save; ignore defensively
    }
  }
  return defaultRules || {};
}

function computeNextStatus(current, desired) {
  const cur = String(current || "");
  const want = String(desired || "");
  if (!want || cur === want) {
    return cur;
  }
  try {
    return transitionIssueStatus(cur, want);
  } catch {
    const order = ["todo", "in_progress", "in_review", "done"];
    const ci = order.indexOf(cur);
    const wi = order.indexOf(want);
    if (ci === -1 || wi === -1 || wi < ci) {
      return null;
    }
    return order[ci + 1] || null;
  }
}

function buildGitlabActivityPayload(payload, gitlabEvent) {
  const kind = payload?.object_kind || payload?.event_type || "";
  const project = payload.project
    ? {
        name: payload.project.name,
        path_with_namespace: payload.project.path_with_namespace,
        web_url: payload.project.web_url
      }
    : null;

  if (kind === "push") {
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    return {
      eventKind: "push",
      ref: payload.ref || null,
      gitlabEvent,
      user: payload.user_name || payload.user_username || null,
      project,
      commits: commits.slice(0, 40).map((c) => ({
        id: c.id,
        title: c.title || null,
        message: c.message ? String(c.message).split("\n")[0].slice(0, 200) : null,
        url: c.url || null
      })),
      totalCommitsCount: payload.total_commits_count ?? commits.length,
      compareUrl: payload.compare || null
    };
  }
  if (kind === "merge_request") {
    const a = payload.object_attributes || {};
    return {
      eventKind: "merge_request",
      gitlabEvent,
      action: a.action || null,
      state: a.state || null,
      title: a.title || null,
      url: a.url || null,
      draft: Boolean(a.draft || a.work_in_progress),
      sourceBranch: a.source_branch || null,
      targetBranch: a.target_branch || null,
      user: a.last_commit?.author?.name || payload.user?.name || null,
      project
    };
  }
  if (kind === "note") {
    const note = payload.object_attributes || {};
    return {
      eventKind: "note",
      gitlabEvent,
      noteable_type: note.noteable_type || null,
      body: note.note ? String(note.note).slice(0, 500) : null,
      project
    };
  }
  return {
    eventKind: kind || "unknown",
    gitlabEvent,
    project
  };
}

function collectSourcesFromPayload(payload) {
  const kind = payload?.object_kind || payload?.event_type || "";
  const sources = [];
  if (kind === "merge_request") {
    sources.push(payload?.object_attributes?.source_branch || "");
    sources.push(payload?.object_attributes?.target_branch || "");
    sources.push(payload?.object_attributes?.title || "");
    sources.push(payload?.object_attributes?.description || "");
    sources.push(payload?.last_commit?.message || "");
  } else if (kind === "push") {
    sources.push(pickTargetBranch(payload));
    const commits = Array.isArray(payload?.commits) ? payload.commits : [];
    for (const c of commits) {
      sources.push(c?.message || "");
    }
  } else if (kind === "note") {
    sources.push(payload?.merge_request?.title || "");
    sources.push(payload?.merge_request?.description || "");
    sources.push(payload?.object_attributes?.note || "");
  }
  return sources;
}

function buildDeliverySummary(payload, issueKeys) {
  const kind = payload?.object_kind || payload?.event_type || "";
  const pname = payload?.project?.path_with_namespace || payload?.project?.name || "GitLab";
  if (kind === "push") {
    const ref = String(payload.ref || "").replace(/^refs\/heads\//, "");
    const n = Array.isArray(payload.commits) ? payload.commits.length : payload.total_commits_count ?? 0;
    const keys = issueKeys.length ? issueKeys.join(", ") : "无匹配任务";
    return `Push ${pname} @ ${ref || "?"} · ${n} commit · 任务 ${keys}`;
  }
  if (kind === "merge_request") {
    const t = payload?.object_attributes?.title || "";
    const keys = issueKeys.length ? issueKeys.join(", ") : "无匹配任务";
    return `MR ${pname}: ${t.slice(0, 80)} · ${keys}`;
  }
  const keys = issueKeys.length ? issueKeys.join(", ") : "无匹配任务";
  return `${kind || "event"} · ${pname} · ${keys}`;
}

module.exports = {
  extractIssuesIdsFromText,
  uniq,
  normalizeGitlabTrigger,
  pickTargetBranch,
  selectRulesForBranch,
  computeNextStatus,
  buildGitlabActivityPayload,
  collectSourcesFromPayload,
  buildDeliverySummary
};
