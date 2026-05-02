import { For, Show, createEffect, createMemo, createSignal, mergeProps, onCleanup } from "solid-js";
import dayjs from "dayjs";
import {
  Btn,
  Dropdown,
  Inp,
  Modal,
  Popover,
  Sel,
  TagSpan,
  TextArea,
  ToggleSwitch
} from "../../ui/primitives.jsx";
import { teamMenuColor } from "../../lib/teamMenuColor";
import { teamSegmentForUrl } from "../../lib/teamSlug";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client";
import { IssueDetail } from "./IssueDetail";
import { defaultIssueViewPrefs, loadIssueViewPrefs, resetIssueViewPrefs, saveIssueViewPrefs } from "./issuePrefs";
import {
  GROUP_ORDER,
  STATUS_META,
  TYPE_FILTER_OPTIONS,
  TYPE_LABEL,
  issueIdentifier,
  routeIssueSegment,
  typeTagClass
} from "./issueUi";

function issuesUrl(teamId) {
  const page = "pageSize=500";
  if (teamId) {
    return `/api/issues?teamId=${encodeURIComponent(teamId)}&${page}`;
  }
  return `/api/issues?${page}`;
}

function navigateTo(path) {
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function computeCycleStatus(startsAt, endsAt, now = new Date()) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (now < start) {
    return "planned";
  }
  if (now > end) {
    return "closed";
  }
  return "active";
}

function pickDefaultCycleId(cycles) {
  const active = cycles
    .filter((c) => computeCycleStatus(c.startsAt, c.endsAt) === "active")
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  if (active.length) {
    return active[0].id;
  }
  const planned = cycles
    .filter((c) => computeCycleStatus(c.startsAt, c.endsAt) === "planned")
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  if (planned.length) {
    return planned[0].id;
  }
  return null;
}

const STATUS_OPTIONS = [
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "进行中" },
  { value: "in_review", label: "评审中" },
  { value: "done", label: "已完成" }
];

const PRIORITY_OPTIONS = [
  { value: 0, label: "无" },
  { value: 1, label: "紧急" },
  { value: 2, label: "高" },
  { value: 3, label: "中" },
  { value: 4, label: "低" }
];

/** Sel 无法用 null，用作「未关联迭代」 sentinel */
const CYCLE_FILTER_NONE = "__cycle_none__";
/** 「未指派」 sentinel */
const ASSIGNEE_FILTER_NONE = "__assignee_none__";

const DUE_PRESET_OPTIONS = [
  { value: "", label: "全部" },
  { value: "no_due", label: "无截止日期" },
  { value: "has_due", label: "有截止日期" },
  { value: "overdue", label: "已逾期（未完成）" },
  { value: "due_today", label: "今天到期" },
  { value: "due_next7", label: "7 天内到期" },
  { value: "due_after7", label: "7 天之后到期" }
];

const CYCLE_PHASE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "active", label: "迭代进行中" },
  { value: "planned", label: "迭代未开始" },
  { value: "closed", label: "迭代已结束" }
];

const ESTIMATE_PRESET_OPTIONS = [
  { value: "", label: "全部" },
  { value: "unset", label: "未填预估工时" },
  { value: "set", label: "已填预估工时" },
  { value: "lte2", label: "≤ 2h" },
  { value: "gte8", label: "≥ 8h" }
];

function emptyIssueFilter() {
  return {
    search: "",
    status: "",
    priority: "",
    type: "",
    projectId: "",
    cyclePick: "",
    cyclePhase: "",
    assigneePick: "",
    labelContains: "",
    duePreset: "",
    estimatePreset: ""
  };
}

function issueMatchesSearchHaystack(issue, queryRaw) {
  const q = queryRaw.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const blobs = [
    issue.title,
    issue.issues_id,
    issue.issueNumber != null ? String(issue.issueNumber) : "",
    ...(Array.isArray(issue.labels) ? issue.labels : [])
  ].map((s) => String(s ?? "").toLowerCase());
  if (blobs.some((b) => b.includes(q))) {
    return true;
  }
  const desc = String(issue.description ?? "").toLowerCase();
  return desc.includes(q);
}

function issueMatchesDuePreset(issue, preset) {
  if (!preset) {
    return true;
  }
  const d = issue.dueDate ? dayjs(issue.dueDate).startOf("day") : null;
  const today = dayjs().startOf("day");

  if (preset === "no_due") {
    return !issue.dueDate;
  }
  if (preset === "has_due") {
    return Boolean(issue.dueDate);
  }
  if (!d) {
    return false;
  }
  const diffDaysFromToday = d.diff(today, "day");

  switch (preset) {
    case "overdue":
      return diffDaysFromToday < 0 && issue.status !== "done";
    case "due_today":
      return diffDaysFromToday === 0;
    case "due_next7":
      return diffDaysFromToday >= 0 && diffDaysFromToday <= 7;
    case "due_after7":
      return diffDaysFromToday > 7;
    default:
      return true;
  }
}

function issueMatchesEstimatePreset(issue, preset) {
  if (!preset) {
    return true;
  }
  const h = issue.estimateHours;
  const hasNum = h != null && Number.isFinite(Number(h));
  if (preset === "unset") {
    return !hasNum;
  }
  if (preset === "set") {
    return hasNum;
  }
  const n = Number(h);
  if (preset === "lte2") {
    return hasNum && n <= 2;
  }
  if (preset === "gte8") {
    return hasNum && n >= 8;
  }
  return true;
}

function filterHasAnySelection(fl) {
  const z = emptyIssueFilter();
  return Object.keys(z).some((k) => String(fl[k] ?? "") !== String(z[k]));
}

const PROJECT_GROUP_NONE = "__proj_none__";

/** 列表视图分组维度（看板仍为固定状态列） */
const LIST_GROUP_OPTIONS = [
  { value: "none", label: "不分组" },
  { value: "status", label: "状态" },
  { value: "priority", label: "优先级" },
  { value: "type", label: "类型" },
  { value: "project", label: "项目" },
  { value: "assignee", label: "负责人" },
  { value: "cycle", label: "迭代" },
  { value: "dueBucket", label: "截止紧迫度" },
  { value: "label", label: "首个标签" },
  { value: "estimateBucket", label: "预估工时" }
];

const LIST_GROUP_KEYS_ALLOWED = new Set(LIST_GROUP_OPTIONS.map((x) => x.value));

function listDueBucketMeta(issue) {
  if (!issue.dueDate) {
    return { key: "nodue", label: "无截止日期" };
  }
  const d = dayjs(issue.dueDate).startOf("day");
  const today = dayjs().startOf("day");
  const diff = d.diff(today, "day");
  if (diff < 0) {
    if (issue.status === "done") {
      return { key: "past_done", label: "已过期（已完成）" };
    }
    return { key: "overdue", label: "已逾期（未完成）" };
  }
  if (diff === 0) {
    return { key: "today", label: "今天到期" };
  }
  if (diff <= 7) {
    return { key: "week", label: "7 天内到期" };
  }
  return { key: "later", label: "更晚到期" };
}

function listEstimateBucketMeta(issue) {
  const h = issue.estimateHours;
  const hasNum = h != null && Number.isFinite(Number(h));
  if (!hasNum) {
    return { key: "est_unset", label: "未填预估" };
  }
  const n = Number(h);
  if (n <= 2) {
    return { key: "est_lte2", label: "≤ 2h" };
  }
  if (n >= 8) {
    return { key: "est_gte8", label: "≥ 8h" };
  }
  return { key: "est_mid", label: "3–7 h" };
}

/** @returns {{ key: string, label: string }} */
function listGroupBucketForIssue(issue, mode, ctx) {
  const { pm, membersList, cyl } = ctx;
  switch (mode) {
    case "status":
      return {
        key: issue.status || "_unknown_status",
        label: STATUS_META[issue.status]?.label ?? issue.status ?? "未知状态"
      };
    case "priority": {
      const pr = Number(issue.priority ?? 0);
      return {
        key: String(Number.isFinite(pr) ? pr : 0),
        label:
          PRIORITY_OPTIONS.find((o) => Number(o.value) === pr)?.label ??
          PRIORITY_OPTIONS.find((o) => Number(o.value) === 0)?.label ??
          "无"
      };
    }
    case "type":
      return {
        key: issue.type || "chore",
        label: TYPE_LABEL[issue.type] ?? issue.type ?? "未知类型"
      };
    case "project":
      return {
        key: issue.projectId ? String(issue.projectId) : PROJECT_GROUP_NONE,
        label: issue.projectId ? (pm[issue.projectId]?.name ?? issue.projectId) : "未归类项目"
      };
    case "assignee": {
      const uid = issue.assigneeId || "";
      if (!uid) {
        return { key: ASSIGNEE_FILTER_NONE, label: "未指派" };
      }
      const m = membersList.find((x) => x.userId === uid);
      return { key: uid, label: m?.name || m?.email || uid };
    }
    case "cycle":
      return {
        key: issue.cycleId || CYCLE_FILTER_NONE,
        label: issue.cycleId ? cyl.find((c) => c.id === issue.cycleId)?.name ?? issue.cycleId : "未关联迭代"
      };
    case "dueBucket":
      return listDueBucketMeta(issue);
    case "label": {
      const labs = [...(Array.isArray(issue.labels) ? issue.labels : [])].sort((a, b) =>
        String(a).localeCompare(String(b), "zh-CN")
      );
      const first = labs[0];
      const key = first != null ? `lb:${String(first)}` : "__no_label__";
      return { key, label: first != null ? String(first) : "未打标签" };
    }
    case "estimateBucket":
      return listEstimateBucketMeta(issue);
    default:
      return { key: String(issue.status || "todo"), label: STATUS_META[issue.status]?.label ?? "Todo" };
  }
}

/** @param {{ key: string, label: string, items: unknown[] }[]} rows */
function sortListGroupRows(rows, mode, ctx) {
  const { cyl } = ctx;
  const prioRank = ["1", "2", "3", "4", "0"];
  const typeRank = ["feature", "bug", "chore"];
  const dueRank = ["overdue", "today", "week", "later", "past_done", "nodue"];
  const estRank = ["est_unset", "est_lte2", "est_mid", "est_gte8"];

  rows.sort((A, B) => {
    const ka = A.key;
    const kb = B.key;
    switch (mode) {
      case "status": {
        const ia = GROUP_ORDER.indexOf(ka);
        const ib = GROUP_ORDER.indexOf(kb);
        const fa = ia === -1 ? GROUP_ORDER.length + String(ka).charCodeAt(0) / 999 : ia;
        const fb = ib === -1 ? GROUP_ORDER.length + String(kb).charCodeAt(0) / 999 : ib;
        if (fa !== fb) {
          return fa - fb;
        }
        break;
      }
      case "priority": {
        const fa = prioRank.indexOf(ka);
        const fb = prioRank.indexOf(kb);
        const ra = fa === -1 ? 999 : fa;
        const rb = fb === -1 ? 999 : fb;
        if (ra !== rb) {
          return ra - rb;
        }
        break;
      }
      case "type": {
        const ta = typeRank.indexOf(ka);
        const tb = typeRank.indexOf(kb);
        const ra = ta === -1 ? 999 : ta;
        const rb = tb === -1 ? 999 : tb;
        if (ra !== rb) {
          return ra - rb;
        }
        break;
      }
      case "project": {
        if (ka === PROJECT_GROUP_NONE && kb !== PROJECT_GROUP_NONE) {
          return 1;
        }
        if (kb === PROJECT_GROUP_NONE && ka !== PROJECT_GROUP_NONE) {
          return -1;
        }
        return String(A.label).localeCompare(String(B.label), "zh-CN");
      }
      case "assignee": {
        if (ka === ASSIGNEE_FILTER_NONE && kb !== ASSIGNEE_FILTER_NONE) {
          return -1;
        }
        if (kb === ASSIGNEE_FILTER_NONE && ka !== ASSIGNEE_FILTER_NONE) {
          return 1;
        }
        return String(A.label).localeCompare(String(B.label), "zh-CN");
      }
      case "cycle": {
        if (ka === CYCLE_FILTER_NONE && kb !== CYCLE_FILTER_NONE) {
          return 1;
        }
        if (kb === CYCLE_FILTER_NONE && ka !== CYCLE_FILTER_NONE) {
          return -1;
        }
        const ca = cyl.find((c) => c.id === ka);
        const cb = cyl.find((c) => c.id === kb);
        const ta = ca ? new Date(ca.startsAt || 0).getTime() : 0;
        const tb = cb ? new Date(cb.startsAt || 0).getTime() : 0;
        if (ta !== tb) {
          return tb - ta;
        }
        break;
      }
      case "dueBucket": {
        const da = dueRank.indexOf(ka);
        const db = dueRank.indexOf(kb);
        const ra = da === -1 ? 999 : da;
        const rb = db === -1 ? 999 : db;
        if (ra !== rb) {
          return ra - rb;
        }
        break;
      }
      case "label": {
        if (ka === "__no_label__" && kb !== "__no_label__") {
          return 1;
        }
        if (kb === "__no_label__" && ka !== "__no_label__") {
          return -1;
        }
        return String(A.label).localeCompare(String(B.label), "zh-CN");
      }
      case "estimateBucket": {
        const ea = estRank.indexOf(ka);
        const eb = estRank.indexOf(kb);
        const ra = ea === -1 ? 999 : ea;
        const rb = eb === -1 ? 999 : eb;
        if (ra !== rb) {
          return ra - rb;
        }
        break;
      }
      default:
        break;
    }
    return ka.localeCompare(kb);
  });
}

const CREATE_MENU = [
  { label: "新增任务", type: "chore" },
  { label: "新增bug", type: "bug" },
  { label: "新增需求", type: "feature" }
];

function emptyCreateForm() {
  return {
    title: "",
    description: "",
    type: "chore",
    status: "todo",
    priority: 2,
    projectId: "",
    cycleId: null,
    cycleEpicId: null,
    estimateHours: "",
    labels: "",
    dueDate: "",
    assigneeId: null
  };
}

const DISP_KEYS = ["id", "status", "assignee", "priority", "project", "dueDate", "cycle", "estimate", "labels", "created", "updated"];

const DISP_LABELS = {
  id: "ID",
  status: "状态",
  assignee: "负责人",
  priority: "优先级",
  project: "项目",
  dueDate: "截止日期",
  cycle: "迭代",
  estimate: "预估",
  labels: "标签",
  created: "创建时间",
  updated: "更新时间"
};

function PriorityBars(props) {
  const filled =
    props.priority === 0 ? 0 : Math.min(4, Math.max(1, 5 - props.priority));
  return (
    <span class="issue-priority-bars" aria-label={`优先级 ${props.priority}`}>
      <For each={[1, 2, 3, 4]}>
        {(i) => (
          <span class={i <= filled ? "issue-priority-bar on" : "issue-priority-bar"} />
        )}
      </For>
    </span>
  );
}

function sortIssues(arr, orderBy, orderDesc) {
  const dir = orderDesc ? -1 : 1;
  const copy = [...arr];
  copy.sort((a, b) => {
    if (orderBy === "priority") {
      return dir * (a.priority - b.priority);
    }
    if (orderBy === "created") {
      return dir * (new Date(a.createdAt) - new Date(b.createdAt));
    }
    if (orderBy === "updated") {
      return dir * (new Date(a.updatedAt) - new Date(b.updatedAt));
    }
    return 0;
  });
  return copy;
}

export function IssueList(raw) {
  const props = mergeProps(
    { teamName: "", workspaceId: "", issueId: "", workspacePathPrefix: "" },
    raw
  );

  function withWorkspacePrefix(path) {
    return `${props.workspacePathPrefix}${path}`;
  }

  let descriptionInputEl;

  const [issues, setIssues] = createSignal([]);
  const [projects, setProjects] = createSignal([]);
  const [teams, setTeams] = createSignal([]);
  const [cycles, setCycles] = createSignal([]);
  const [members, setMembers] = createSignal([]);
  const [form, setForm] = createSignal(emptyCreateForm());
  const [error, setError] = createSignal("");
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [createMore, setCreateMore] = createSignal(false);
  const [filter, setFilter] = createSignal(emptyIssueFilter());
  const [rangeTab, setRangeTab] = createSignal("all");
  const [viewPrefs, setViewPrefs] = createSignal(defaultIssueViewPrefs());
  const [cycleEpics, setCycleEpics] = createSignal([]);

  createEffect(() => {
    const tid = props.teamId;
    const wid = props.workspaceId;
    let alive = true;
    setViewPrefs(defaultIssueViewPrefs());
    if (!wid) {
      return;
    }
    loadIssueViewPrefs(tid, wid).then((p) => {
      if (alive) {
        setViewPrefs(p);
      }
    });
    onCleanup(() => {
      alive = false;
    });
  });

  createEffect(() => {
    const tid = props.teamId;
    const wid = props.workspaceId;
    function onKey(ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "b") {
        ev.preventDefault();
        setViewPrefs((prev) => {
          const next = { ...prev, viewMode: prev.viewMode === "list" ? "board" : "list" };
          saveIssueViewPrefs(tid, wid, next);
          return next;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  function updateViewPrefs(partial) {
    const wid = props.workspaceId;
    setViewPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveIssueViewPrefs(props.teamId, wid, next);
      return next;
    });
  }

  function toggleColumn(key) {
    const wid = props.workspaceId;
    setViewPrefs((prev) => {
      const next = { ...prev, columns: { ...prev.columns, [key]: !prev.columns[key] } };
      saveIssueViewPrefs(props.teamId, wid, next);
      return next;
    });
  }

  function mergeForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function loadIssues() {
    const data = await apiGet(issuesUrl(props.teamId));
    setIssues(data.items ?? []);
  }

  createEffect(() => {
    const teamIdProp = props.teamId;
    let alive = true;
    const reqs = teamIdProp
      ? [
          apiGet(issuesUrl(teamIdProp)),
          apiGet("/api/projects"),
          apiGet(`/api/cycles?teamId=${encodeURIComponent(teamIdProp)}`)
        ]
      : [apiGet(issuesUrl()), apiGet("/api/projects"), apiGet("/api/teams")];
    Promise.all(reqs)
      .then(([a, b, c]) => {
        if (!alive) {
          return;
        }
        if (teamIdProp) {
          setIssues(a.items ?? []);
          setProjects(b.items ?? []);
          setCycles(c.items ?? []);
          setTeams([]);
        } else {
          setIssues(a.items ?? []);
          setProjects(b.items ?? []);
          setTeams(c.items ?? []);
          setCycles([]);
        }
      })
      .catch(() => {
        if (alive) {
          setError("Issue 加载失败");
        }
      });
    onCleanup(() => {
      alive = false;
    });
  });

  createEffect(() => {
    const wid = props.workspaceId;
    if (!wid) {
      setMembers([]);
      return;
    }
    let alive = true;
    apiGet(`/api/workspaces/${encodeURIComponent(wid)}/members`)
      .then((data) => {
        if (alive) {
          setMembers(data.items ?? []);
        }
      })
      .catch(() => {
        if (alive) {
          setMembers([]);
        }
      });
    onCleanup(() => {
      alive = false;
    });
  });

  createEffect(() => {
    if (!showCreateModal() || !props.teamId) {
      return;
    }
    const c = cycles();
    const fid = pickDefaultCycleId(c);
    if (!fid) {
      return;
    }
    const f = form();
    if (f.cycleId) {
      return;
    }
    mergeForm({ cycleId: fid });
  });

  createEffect(() => {
    const pr = projects();
    const f = form();
    if (pr.length && !f.projectId && showCreateModal()) {
      mergeForm({ projectId: pr[0].id });
    }
  });

  createEffect(() => {
    const cid = form().cycleId;
    if (!cid || !showCreateModal()) {
      setCycleEpics([]);
      return;
    }
    let alive = true;
    apiGet(`/api/cycles/${encodeURIComponent(cid)}/epics`)
      .then((d) => {
        if (alive) {
          setCycleEpics(d.items ?? []);
        }
      })
      .catch(() => {
        if (alive) {
          setCycleEpics([]);
        }
      });
    onCleanup(() => {
      alive = false;
    });
  });

  function openCreateModalForType(type) {
    setError("");
    mergeForm({
      ...emptyCreateForm(),
      type,
      projectId: projects()[0]?.id ?? "",
      cycleId: pickDefaultCycleId(cycles())
    });
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setForm(emptyCreateForm());
    setError("");
  }

  async function handleCreateIssue(event) {
    event?.preventDefault?.();
    const f = form();
    if (!f.title.trim()) {
      setError("请输入任务标题");
      return;
    }
    const teamIdVal = props.teamId || teams()[0]?.id;
    if (!f.projectId || !teamIdVal) {
      setError("请先选择 Project 并确保在团队上下文中");
      return;
    }
    setError("");
    try {
      await apiPost("/api/issues", {
        projectId: f.projectId,
        teamId: teamIdVal,
        title: f.title.trim(),
        description: f.description.trim() || null,
        type: f.type,
        status: f.status,
        priority: Number(f.priority),
        cycleId: f.cycleId || null,
        cycleEpicId: f.cycleEpicId || null,
        estimateHours: (() => {
          if (f.estimateHours === "" || f.estimateHours == null) {
            return null;
          }
          const n = Number(f.estimateHours);
          return Number.isFinite(n) ? n : null;
        })(),
        labels: f.labels
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        dueDate: f.dueDate || null,
        assigneeId: f.assigneeId || null
      });
      await loadIssues();
      if (createMore()) {
        setForm({
          ...emptyCreateForm(),
          type: f.type,
          projectId: f.projectId,
          cycleId: f.cycleId,
          cycleEpicId: f.cycleEpicId
        });
      } else {
        closeCreateModal();
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "创建任务失败");
    }
  }

  async function handleDeleteIssue(issueIdToDelete) {
    try {
      await apiDelete(`/api/issues/${issueIdToDelete}`);
      setIssues((prev) => prev.filter((item) => item.id !== issueIdToDelete));
    } catch {
      setError("删除任务失败");
    }
  }

  async function handleStatusChange(id, status) {
    try {
      const updated = await apiPatch(`/api/issues/${id}`, { status });
      setIssues((prev) => prev.map((item) => (item.id === id ? updated : item)));
    } catch {
      setError("更新状态失败");
    }
  }

  const projectMap = createMemo(() => Object.fromEntries(projects().map((p) => [p.id, p])));

  const filteredIssues = createMemo(() => {
    const cyl = cycles();
    return issues().filter((issue) => {
      const fl = filter();
      if (!issueMatchesSearchHaystack(issue, fl.search)) {
        return false;
      }
      if (fl.status && issue.status !== fl.status) {
        return false;
      }
      if (fl.priority && String(issue.priority) !== String(fl.priority)) {
        return false;
      }
      if (fl.type && issue.type !== fl.type) {
        return false;
      }
      if (fl.projectId && issue.projectId !== fl.projectId) {
        return false;
      }

      if (fl.cyclePick === CYCLE_FILTER_NONE) {
        if (issue.cycleId) {
          return false;
        }
      } else if (fl.cyclePick && issue.cycleId !== fl.cyclePick) {
        return false;
      }

      if (fl.cyclePhase) {
        if (!issue.cycleId) {
          return false;
        }
        const cy = cyl.find((c) => c.id === issue.cycleId);
        if (!cy) {
          return false;
        }
        const st = computeCycleStatus(cy.startsAt, cy.endsAt);
        if (st !== fl.cyclePhase) {
          return false;
        }
      }

      if (fl.assigneePick === ASSIGNEE_FILTER_NONE) {
        if (issue.assigneeId) {
          return false;
        }
      } else if (fl.assigneePick && issue.assigneeId !== fl.assigneePick) {
        return false;
      }

      if (fl.labelContains.trim()) {
        const q = fl.labelContains.trim().toLowerCase();
        const labels = issue.labels || [];
        if (!labels.some((lb) => String(lb).toLowerCase().includes(q))) {
          return false;
        }
      }

      if (!issueMatchesDuePreset(issue, fl.duePreset)) {
        return false;
      }

      if (!issueMatchesEstimatePreset(issue, fl.estimatePreset)) {
        return false;
      }

      if (rangeTab() === "active" && issue.status === "done") {
        return false;
      }
      if (rangeTab() === "backlog" && issue.status !== "todo") {
        return false;
      }
      return true;
    });
  });

  const sortedIssues = createMemo(() => {
    const vp = viewPrefs();
    return sortIssues(filteredIssues(), vp.orderBy, vp.orderDesc);
  });

  const groupedForList = createMemo(() => {
    const vpAll = viewPrefs();
    const raw = vpAll.listGroupBy ?? "none";
    const mode = LIST_GROUP_KEYS_ALLOWED.has(raw) ? raw : "status";
    if (mode === "none") {
      return null;
    }

    const items = sortedIssues();
    const ctx = {
      pm: projectMap(),
      membersList: members(),
      cyl: cycles()
    };

    const map = new Map();
    for (const issue of items) {
      const b = listGroupBucketForIssue(issue, mode, ctx);
      const row = map.get(b.key);
      if (row) {
        row.items.push(issue);
      } else {
        map.set(b.key, { key: b.key, label: b.label, groupMode: mode, items: [issue] });
      }
    }
    let rows = [...map.values()];
    sortListGroupRows(rows, mode, ctx);

    /** 与其它「空列」行为一致：仅状态分组可按固定流水线展示空分组 */
    if (mode === "status" && vpAll.showEmptyBoardColumns) {
      const byKey = new Map(rows.map((r) => [r.key, r]));
      rows = GROUP_ORDER.map((status) => {
        const hit = byKey.get(status);
        if (hit) {
          return hit;
        }
        return {
          key: status,
          label: STATUS_META[status]?.label ?? status,
          groupMode: mode,
          items: []
        };
      });
    }

    return rows;
  });

  const boardColumns = createMemo(() => {
    const byStatus = {};
    for (const s of GROUP_ORDER) {
      byStatus[s] = [];
    }
    for (const issue of sortedIssues()) {
      if (!byStatus[issue.status]) {
        byStatus[issue.status] = [];
      }
      byStatus[issue.status].push(issue);
    }
    const vp = viewPrefs();
    const cols = GROUP_ORDER.filter(
      (s) => vp.showEmptyBoardColumns || (byStatus[s] && byStatus[s].length > 0)
    );
    if (cols.length === 0) {
      return GROUP_ORDER.map((s) => ({ status: s, items: byStatus[s] || [] }));
    }
    return cols.map((s) => ({ status: s, items: byStatus[s] || [] }));
  });

  function memberShort(userId) {
    const m = members().find((x) => x.userId === userId);
    return (m?.name || "?").slice(0, 1);
  }

  function teamPathSeg() {
    return teamSegmentForUrl({ name: props.teamName, id: props.teamId });
  }

  function renderIssueRowExtra(issue) {
    const c = viewPrefs().columns;
    const p = projectMap()[issue.projectId];
    const idStr = issueIdentifier(issue, p);
    const cycle = issue.cycleId ? cycles().find((x) => x.id === issue.cycleId) : null;

    return (
      <div class="issue-row-meta">
        {c.id ? <span class="issue-row-id muted">{idStr}</span> : null}
        {c.status ? (
          <Popover
            placement="bottomLeft"
            content={
              <Sel
                style={{ width: "160px" }}
                aria-label="更改状态"
                value={issue.status}
                options={STATUS_OPTIONS}
                onChange={(v) => handleStatusChange(issue.id, v)}
              />
            }
          >
            <button type="button" class="issue-row-status-hit" aria-label="更改状态">
              <span class="issue-status-dot" style={{ background: STATUS_META[issue.status]?.dot }} />
            </button>
          </Popover>
        ) : null}
        {c.priority ? <PriorityBars priority={issue.priority} /> : null}
        {c.project ? <span class="issue-row-pill muted">{p?.name ?? "—"}</span> : null}
        {c.cycle ? <span class="issue-row-pill muted">{cycle?.name ?? "—"}</span> : null}
        {c.estimate ? (
          <span class="muted issue-row-mini">{issue.estimateHours != null ? `${issue.estimateHours}h` : ""}</span>
        ) : null}
        {c.dueDate && issue.dueDate ? (
          <span class="muted issue-row-mini">{dayjs(issue.dueDate).format("MMM D")}</span>
        ) : null}
        {c.labels
          ? (issue.labels || []).slice(0, 3).map((lb) => (
              <TagSpan class="issue-label-chip">{lb}</TagSpan>
            ))
          : null}
        {c.assignee ? (
          issue.assigneeId ? (
            <span class="issue-assignee-circle" title="负责人">
              {memberShort(issue.assigneeId)}
            </span>
          ) : (
            <span class="issue-unassigned" aria-hidden title="未指派" />
          )
        ) : null}
        {c.created ? (
          <span class="muted issue-row-mini">{dayjs(issue.createdAt).format("MM-DD")}</span>
        ) : null}
        {c.updated ? (
          <span class="muted issue-row-mini">{dayjs(issue.updatedAt).format("MM-DD")}</span>
        ) : null}
      </div>
    );
  }

  function IssueRow(propsRow) {
    const issue = () => propsRow.issue;
    return (
      <li class="issue-row-linear">
        <button
          type="button"
          class="issue-row-main"
          onClick={() =>
            navigateTo(
              withWorkspacePrefix(`/workspace/teams/${teamPathSeg()}/issues/${routeIssueSegment(issue(), projectMap()[issue().projectId])}`)
            )
          }
        >
          <span class="issue-row-title">{issue().title}</span>
        </button>
        {renderIssueRowExtra(issue())}
        <Dropdown
          items={[
            {
              label: "删除",
              danger: true,
              onClick: () => handleDeleteIssue(issue().id)
            }
          ]}
        >
          <Btn variant="text" aria-label="更多">
            ⋮
          </Btn>
        </Dropdown>
      </li>
    );
  }

  function renderGroupedListBody() {
    const gl = groupedForList();
    if (!gl) {
      return null;
    }
    const vp = viewPrefs();
    return gl
      .filter(({ items: groupItems }) => groupItems.length > 0 || vp.showEmptyBoardColumns)
      .map((row) => {
      const gm = row.groupMode;
      const dotColor = gm === "status" ? STATUS_META[row.key]?.dot : null;
      return (
        <section class="issue-group">
          <h3 class="issue-group-title">
            <Show when={dotColor}>
              <span class="issue-status-dot" style={{ background: dotColor }} />
            </Show>
            {row.label} <span class="muted">{row.items.length}</span>
          </h3>
          <ul class="issue-list-linear">
            <For each={row.items}>{(issue) => <IssueRow issue={issue} />}</For>
          </ul>
        </section>
      );
    });
  }

  function renderFlatListBody() {
    return (
      <ul class="issue-list-linear">
        <For each={sortedIssues()}>{(issue) => <IssueRow issue={issue} />}</For>
      </ul>
    );
  }

  function renderBoard() {
    return (
      <div class="issue-board-wrap">
        <For each={boardColumns()}>
          {(col) => {
            const label = STATUS_META[col.status]?.label ?? col.status;
            return (
              <div class="issue-board-column">
                <div class="issue-board-column-head">
                  <span class="issue-status-dot" style={{ background: STATUS_META[col.status]?.dot }} />
                  <strong>{label}</strong>
                  <span class="muted">{col.items.length}</span>
                </div>
                <ul class="issue-board-cards">
                  <For each={col.items}>
                    {(issue) => {
                      const p = projectMap()[issue.projectId];
                      const idStr = issueIdentifier(issue, p);
                      const c = viewPrefs().columns;
                      return (
                        <li>
                          <button
                            type="button"
                            class="issue-board-card"
                            onClick={() =>
                              navigateTo(
                                withWorkspacePrefix(
                                  `/workspace/teams/${teamPathSeg()}/issues/${routeIssueSegment(issue, projectMap()[issue.projectId])}`
                                )
                              )
                            }
                          >
                            {c.id ? <div class="issue-card-id muted">{idStr}</div> : null}
                            <div class="issue-card-title">{issue.title}</div>
                            <div class="issue-card-foot">
                              {c.priority ? <PriorityBars priority={issue.priority} /> : null}
                              {c.assignee ? (
                                <span class="issue-assignee-circle sm">{memberShort(issue.assigneeId)}</span>
                              ) : null}
                              {c.labels ? (
                                <TagSpan class={typeTagClass(issue.type)}>{TYPE_LABEL[issue.type]}</TagSpan>
                              ) : null}
                            </div>
                            {c.created ? (
                              <div class="muted issue-card-created">创建于 {dayjs(issue.createdAt).format("MM-DD")}</div>
                            ) : null}
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>
            );
          }}
        </For>
      </div>
    );
  }

  const filterIsActive = createMemo(() => filterHasAnySelection(filter()));

  function filterPopoverInner() {
    const f = filter();
    const cycleSelOptions = [
      { value: "", label: "全部迭代" },
      { value: CYCLE_FILTER_NONE, label: "未关联迭代" },
      ...[...cycles()]
        .sort((a, b) => new Date(b.startsAt || 0) - new Date(a.startsAt || 0))
        .map((cy) => ({ value: cy.id, label: cy.name || cy.id }))
    ];
    const assigneeSelOptions = [
      { value: "", label: "全部" },
      { value: ASSIGNEE_FILTER_NONE, label: "未指派" },
      ...members().map((m) => ({
        value: m.userId,
        label: m.name || m.email || m.userId
      }))
    ];

    return (
      <div class="issue-view-popover issue-view-popover--filters">
        <div class="issue-view-popover-title">筛选条件</div>
        <div class="issue-view-field">
          <span class="issue-view-label">关键词</span>
          <Inp
            aria-label="Search issues"
            class="issue-filter-pop-input"
            placeholder="标题、编号、标签、描述"
            value={f.search}
            onInput={(ev) =>
              setFilter((prev) => ({
                ...prev,
                search: ev.target.value
              }))
            }
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">状态</span>
          <Sel
            class="fullw"
            aria-label="Filter status"
            value={f.status}
            onChange={(value) =>
              setFilter((prev) => ({
                ...prev,
                status: value
              }))
            }
            options={[{ value: "", label: "全部" }, ...STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">优先级</span>
          <Sel
            class="fullw"
            aria-label="Filter priority"
            value={String(f.priority ?? "")}
            onChange={(value) =>
              setFilter((prev) => ({
                ...prev,
                priority: value === "" ? "" : value
              }))
            }
            options={[{ value: "", label: "全部" }, ...PRIORITY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))]}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">类型</span>
          <Sel
            class="fullw"
            aria-label="Filter issue type"
            value={f.type}
            onChange={(value) => setFilter((prev) => ({ ...prev, type: value }))}
            options={[{ value: "", label: "全部" }, ...TYPE_FILTER_OPTIONS]}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">项目</span>
          <Sel
            class="fullw"
            aria-label="Filter project"
            value={f.projectId}
            onChange={(value) => setFilter((prev) => ({ ...prev, projectId: value }))}
            options={[{ value: "", label: "全部" }, ...projects().map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">迭代</span>
          <Sel
            class="fullw"
            aria-label="Filter cycle"
            value={f.cyclePick}
            onChange={(value) => setFilter((prev) => ({ ...prev, cyclePick: value }))}
            options={cycleSelOptions}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">迭代阶段</span>
          <Sel
            class="fullw"
            aria-label="Filter cycle phase"
            value={f.cyclePhase}
            onChange={(value) => setFilter((prev) => ({ ...prev, cyclePhase: value }))}
            options={CYCLE_PHASE_OPTIONS}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">负责人</span>
          <Sel
            class="fullw"
            aria-label="Filter assignee"
            value={f.assigneePick}
            onChange={(value) => setFilter((prev) => ({ ...prev, assigneePick: value }))}
            options={assigneeSelOptions}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">标签包含</span>
          <Inp
            aria-label="Filter labels contains"
            class="issue-filter-pop-input"
            placeholder="匹配任一标签"
            value={f.labelContains}
            onInput={(ev) =>
              setFilter((prev) => ({
                ...prev,
                labelContains: ev.target.value
              }))
            }
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">截止日期</span>
          <Sel
            class="fullw"
            aria-label="Filter due date"
            value={f.duePreset}
            onChange={(value) => setFilter((prev) => ({ ...prev, duePreset: value }))}
            options={DUE_PRESET_OPTIONS}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">预估工时</span>
          <Sel
            class="fullw"
            aria-label="Filter estimate hours"
            value={f.estimatePreset}
            onChange={(value) => setFilter((prev) => ({ ...prev, estimatePreset: value }))}
            options={ESTIMATE_PRESET_OPTIONS}
          />
        </div>
        <Btn variant="link" onClick={() => setFilter(emptyIssueFilter())}>
          清除筛选
        </Btn>
      </div>
    );
  }

  function displayPopoverInner() {
    const vp = viewPrefs();
    return (
      <div class="issue-view-popover">
        <div class="issue-view-popover-title">布局</div>
        <div class="issue-view-layout-toggle">
          <Btn
            variant={vp.viewMode === "list" ? "primary" : "default"}
            onClick={() => updateViewPrefs({ viewMode: "list" })}
          >
            列表
          </Btn>
          <Btn
            variant={vp.viewMode === "board" ? "primary" : "default"}
            title="Ctrl B"
            onClick={() => updateViewPrefs({ viewMode: "board" })}
          >
            看板
          </Btn>
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">分组</span>
          <Sel
            class="fullw"
            aria-label="List group dimension"
            value={LIST_GROUP_KEYS_ALLOWED.has(vp.listGroupBy) ? vp.listGroupBy : "status"}
            onChange={(v) => updateViewPrefs({ listGroupBy: v })}
            options={LIST_GROUP_OPTIONS}
          />
        </div>
        <div class="issue-view-field">
          <span class="issue-view-label">排序</span>
          <div class="issue-view-order-row">
            <Sel
              value={vp.orderBy}
              onChange={(v) => updateViewPrefs({ orderBy: v })}
              options={[
                { value: "priority", label: "优先级" },
                { value: "updated", label: "更新时间" },
                { value: "created", label: "创建时间" }
              ]}
            />
            <Btn variant="default" onClick={() => updateViewPrefs({ orderDesc: !vp.orderDesc })}>
              {vp.orderDesc ? "降序" : "升序"}
            </Btn>
          </div>
        </div>
        {vp.viewMode === "board" ? (
          <div class="issue-view-field issue-view-switch-row">
            <span>显示空列</span>
            <ToggleSwitch checked={vp.showEmptyBoardColumns} onChange={(v) => updateViewPrefs({ showEmptyBoardColumns: v })} />
          </div>
        ) : (
          <div class="issue-view-field issue-view-switch-row">
            <span>显示空分组</span>
            <ToggleSwitch checked={vp.showEmptyBoardColumns} onChange={(v) => updateViewPrefs({ showEmptyBoardColumns: v })} />
          </div>
        )}
        <div class="issue-view-popover-title">显示属性</div>
        <div class="issue-display-prop-grid">
          <For each={DISP_KEYS}>
            {(k) => (
              <button
                type="button"
                class={vp.columns[k] ? "issue-disp-prop on" : "issue-disp-prop"}
                onClick={() => toggleColumn(k)}
              >
                {DISP_LABELS[k]}
              </button>
            )}
          </For>
        </div>
        <Btn
          variant="link"
          onClick={() => {
            const r = resetIssueViewPrefs();
            setViewPrefs(r);
            saveIssueViewPrefs(props.teamId, props.workspaceId, r);
          }}
        >
          重置
        </Btn>
      </div>
    );
  }

  function createMenuDropdownItems() {
    return CREATE_MENU.map((item) => ({
      label: item.label,
      onClick: () => openCreateModalForType(item.type)
    }));
  }

  /** 与「新增任务 / 新增 bug / 新增需求」菜单一致 */
  function createModalBreadTitle() {
    const hit = CREATE_MENU.find((item) => item.type === form().type);
    return hit?.label ?? "新建任务";
  }

  function createModalSubmitLabel() {
    if (form().type === "bug") {
      return "创建 Bug";
    }
    if (form().type === "feature") {
      return "创建需求";
    }
    return "创建任务";
  }

  const teamColor = () => teamMenuColor({ id: props.teamId || teams()[0]?.id || "default" });
  const teamInitial = () => (props.teamName || teams()[0]?.name || "T").slice(0, 1).toUpperCase();

  const statusLabel = () => STATUS_OPTIONS.find((o) => o.value === form().status)?.label ?? form().status;
  const priorityLabel = () => PRIORITY_OPTIONS.find((o) => o.value === form().priority)?.label ?? `P${form().priority}`;
  const projectLabel = () => projects().find((p) => p.id === form().projectId)?.name ?? "Project";

  function cycleLabel() {
    const f = form();
    if (!f.cycleId) {
      return "迭代";
    }
    const cyc = cycles().find((x) => x.id === f.cycleId);
    return cyc?.name ?? "迭代";
  }

  function epicLabel() {
    const f = form();
    if (!f.cycleEpicId) {
      return "大需求";
    }
    const ep = cycleEpics().find((e) => e.id === f.cycleEpicId);
    return ep?.name ?? "大需求";
  }

  function assigneeLabel() {
    const f = form();
    if (!f.assigneeId) {
      return "负责人";
    }
    const m = members().find((x) => x.userId === f.assigneeId);
    return m?.name ?? "负责人";
  }

  return (
    <>
      <Show when={props.issueId}>
        <IssueDetail
          issueId={props.issueId}
          teamId={props.teamId}
          teamName={props.teamName}
          workspacePathPrefix={props.workspacePathPrefix}
          projects={projects()}
          cycles={cycles()}
          members={members()}
          onIssueDeleted={() => loadIssues()}
          onIssueUpdated={(updated) => {
            setIssues((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
          }}
        />
      </Show>

      <Show when={!props.issueId}>
        <section class="issue-panel surface-card">
          <div class="issue-toolbar issue-toolbar-extended">
            <div class="issue-toolbar-left">
              <h2 class="panel-title issue-page-title">任务</h2>
              <div class="issue-range-tabs">
                <button
                  type="button"
                  class={rangeTab() === "all" ? "issue-range-tab active" : "issue-range-tab"}
                  onClick={() => setRangeTab("all")}
                >
                  全部
                </button>
                <button
                  type="button"
                  class={rangeTab() === "active" ? "issue-range-tab active" : "issue-range-tab"}
                  onClick={() => setRangeTab("active")}
                >
                  进行中
                </button>
                <button
                  type="button"
                  class={rangeTab() === "backlog" ? "issue-range-tab active" : "issue-range-tab"}
                  onClick={() => setRangeTab("backlog")}
                >
                  待办积压
                </button>
              </div>
            </div>
            <div class="issue-toolbar-actions">
              <Popover placement="bottomRight" title="视图与显示" content={displayPopoverInner}>
                <Btn variant="default" aria-label="视图与显示" class="toolbar-quiet-btn">
                  视图
                </Btn>
              </Popover>
              <Popover placement="bottomRight" title="筛选任务" content={filterPopoverInner}>
                <Btn
                  variant="default"
                  aria-label="筛选任务"
                  class={filterIsActive() ? "toolbar-quiet-btn toolbar-quiet-btn--filters-on" : "toolbar-quiet-btn"}
                >
                  筛选
                </Btn>
              </Popover>
              <Dropdown items={createMenuDropdownItems()}>
                <Btn variant="primary" aria-label="打开新建任务菜单" class="btn-new-issue">
                  新建
                </Btn>
              </Dropdown>
            </div>
          </div>
          {error() ? <p class="error-text">{error()}</p> : null}
          {!props.teamId ? (
            <p class="muted">请在团队中查看任务列表。</p>
          ) : sortedIssues().length === 0 ? (
            <p class="muted">暂无任务。</p>
          ) : viewPrefs().viewMode === "board" ? (
            renderBoard()
          ) : groupedForList() ? (
            renderGroupedListBody()
          ) : (
            renderFlatListBody()
          )}

          <Modal
            open={showCreateModal()}
            wide
            ariaLabel={createModalBreadTitle()}
            class="issue-create-modal"
            onClose={() => closeCreateModal()}
          >
            <div class="issue-create-modal-inner">
              <header class="issue-create-modal-header">
                <div class="issue-create-breadcrumb" aria-label="创建上下文">
                  <span
                    class="issue-create-team-badge"
                    style={{
                      background: `color-mix(in srgb, ${teamColor()} 20%, var(--bg-elevated, #fff))`,
                      color: teamColor()
                    }}
                  >
                    {teamInitial()}
                  </span>
                  <span class="issue-create-team-name">{props.teamName || teams()[0]?.name || "Team"}</span>
                  <span class="issue-create-bc-sep" aria-hidden>
                    ›
                  </span>
                  <span class="issue-create-bc-title">{createModalBreadTitle()}</span>
                </div>
                <div class="issue-create-header-actions">
                  <Btn variant="text" aria-label="关闭" onClick={() => closeCreateModal()}>
                    ✕
                  </Btn>
                </div>
              </header>

              <div class="issue-create-body">
                <Inp
                  class="issue-create-title-input"
                  variant="borderless"
                  aria-label="Issue title"
                  placeholder="任务标题"
                  value={form().title}
                  onInput={(e) => mergeForm({ title: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      descriptionInputEl?.focus();
                    }
                  }}
                />
                <TextArea
                  ref={descriptionInputEl}
                  class="issue-create-desc-input"
                  variant="borderless"
                  aria-label="Issue description"
                  placeholder="添加描述…"
                  rows={4}
                  value={form().description}
                  onInput={(e) => mergeForm({ description: e.target.value })}
                />

                <div class="issue-create-pills" role="toolbar" aria-label="任务属性">
                  <Popover
                    placement="bottomLeft"
                    content={
                      <Sel
                        aria-label="Issue status"
                        style={{ minWidth: "160px" }}
                        value={form().status}
                        onChange={(value) => mergeForm({ status: value })}
                        options={STATUS_OPTIONS}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-create-pill-dot" />
                      {statusLabel()}
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Sel
                        aria-label="Issue priority"
                        style={{ minWidth: "140px" }}
                        value={form().priority}
                        onChange={(value) => mergeForm({ priority: Number(value) })}
                        options={PRIORITY_OPTIONS}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-pill-prefix">P</span>
                      {priorityLabel()}
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Sel
                        aria-label="Issue assignee"
                        style={{ minWidth: "200px" }}
                        value={form().assigneeId || ""}
                        onChange={(value) =>
                          mergeForm({ assigneeId: value === "" ? null : value })
                        }
                        options={[
                          { value: "", label: "未指派" },
                          ...members().map((m) => ({ value: m.userId, label: m.name }))
                        ]}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-pill-prefix">@</span>
                      {assigneeLabel()}
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Sel
                        aria-label="Issue project"
                        style={{ minWidth: "200px" }}
                        value={form().projectId || ""}
                        onChange={(value) => mergeForm({ projectId: value })}
                        options={projects().map((p) => ({ value: p.id, label: p.name }))}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-pill-prefix">□</span>
                      {projectLabel()}
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Inp
                        aria-label="Issue estimate"
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="工时（小时）"
                        style={{ width: "200px" }}
                        value={form().estimateHours}
                        onInput={(e) => mergeForm({ estimateHours: e.target.value })}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-pill-prefix issue-pill-prefix--mono">h</span>
                      预估
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Inp
                        aria-label="Issue labels"
                        placeholder="标签，逗号分隔"
                        style={{ width: "220px" }}
                        value={form().labels}
                        onInput={(e) => mergeForm({ labels: e.target.value })}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-pill-prefix">#</span>
                      标签
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Sel
                        aria-label="Issue cycle"
                        style={{ minWidth: "220px" }}
                        value={form().cycleId || ""}
                        onChange={(value) => mergeForm({ cycleId: value || null, cycleEpicId: null })}
                        options={[
                          { value: "", label: "不关联迭代" },
                          ...cycles().map((c) => ({
                          value: c.id,
                          label: `${c.name} (${computeCycleStatus(c.startsAt, c.endsAt) === "active" ? "当前" : computeCycleStatus(c.startsAt, c.endsAt) === "planned" ? "未开始" : "已结束"})`
                        }))
                        ]}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill">
                      <span class="issue-pill-prefix">↻</span>
                      {cycleLabel()}
                    </button>
                  </Popover>

                  <Popover
                    placement="bottomLeft"
                    content={
                      <Sel
                        aria-label="大需求"
                        style={{ minWidth: "220px" }}
                        value={form().cycleEpicId || ""}
                        onChange={(value) => mergeForm({ cycleEpicId: value || null })}
                        options={[
                          { value: "", label: form().cycleId ? "不关联大需求" : "请先选择迭代" },
                          ...cycleEpics().map((e) => ({ value: e.id, label: e.name }))
                        ]}
                      />
                    }
                  >
                    <button type="button" class="issue-create-pill" disabled={!form().cycleId}>
                      <span class="issue-pill-prefix">◇</span>
                      {epicLabel()}
                    </button>
                  </Popover>
                </div>
              </div>

              <footer class="issue-create-footer">
                <Btn variant="text" disabled aria-label="附件（即将支持）" class="issue-create-attach-btn">
                  附件
                </Btn>
                <div class="issue-create-footer-center">
                  <span class="issue-create-footer-label">继续创建</span>
                  <ToggleSwitch checked={createMore()} onChange={(v) => setCreateMore(v)} aria-label="继续创建" />
                </div>
                <Btn variant="primary" class="issue-create-submit" onClick={(e) => handleCreateIssue(e)}>
                  {createModalSubmitLabel()}
                </Btn>
              </footer>
            </div>
          </Modal>

        </section>
      </Show>
    </>
  );
}
