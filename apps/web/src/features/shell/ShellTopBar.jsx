import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Dropdown, Inp, Popover } from "../../ui/primitives.jsx";
import { apiGet } from "../../api/client";
import { issueDetailPath, projectDetailPath } from "../../lib/appPaths.js";

/** 派发全局搜索（顶层栏回车且无下拉结果时）；IssueList 等处监听 `ordo-global-search` */
function dispatchGlobalSearch(query) {
  window.dispatchEvent(
    new CustomEvent("ordo-global-search", {
      detail: { query: query != null ? String(query).trim() : "" }
    })
  );
}

function userInitial(name) {
  const s = String(name || "").trim();
  return s ? s.slice(0, 1).toUpperCase() : "?";
}

function statusLabel(status) {
  if (status === "in_progress") {
    return "进行中";
  }
  if (status === "todo") {
    return "待开始";
  }
  return String(status || "");
}

/**
 * @param {{
 *   userDisplayName?: string | null,
 *   workspacePathPrefix: string,
 *   myPendingWorkTotal?: number | null,
 *   myPendingWorkItems?: Array<{ id: string, issues_id: string, title: string, status: string }>,
 *   myIssuesPath: string,
 *   workspaceSettingsPath: string,
 *   navigateTo: (path: string) => void
 * }} props
 */
export function ShellTopBar(props) {
  const [search, setSearch] = createSignal("");
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [quickLoading, setQuickLoading] = createSignal(false);
  const [quickErr, setQuickErr] = createSignal("");
  const [quickResults, setQuickResults] = createSignal({ projects: [], issues: [] });

  let searchWrapEl = /** @type {HTMLDivElement | undefined} */ (undefined);

  const displayName = () => {
    const n = props.userDisplayName;
    return typeof n === "string" && n.trim() ? n.trim() : "用户";
  };

  createEffect(() => {
    const prefix = String(props.workspacePathPrefix || "").trim();
    const q = search().trim();
    if (!prefix || !q) {
      setQuickResults({ projects: [], issues: [] });
      setQuickErr("");
      if (!q) {
        setPanelOpen(false);
      }
      setQuickLoading(false);
      return;
    }

    setQuickLoading(true);
    setQuickErr("");
    const scheduled = q;
    const timer = window.setTimeout(() => {
      if (search().trim() !== scheduled) {
        return;
      }
      apiGet(`/api/search/quick?q=${encodeURIComponent(scheduled)}`)
        .then((data) => {
          if (search().trim() !== scheduled) {
            return;
          }
          setQuickResults({
            projects: Array.isArray(data?.projects) ? data.projects : [],
            issues: Array.isArray(data?.issues) ? data.issues : []
          });
          setPanelOpen(true);
        })
        .catch(() => {
          if (search().trim() !== scheduled) {
            return;
          }
          setQuickErr("搜索失败，请稍后重试");
          setQuickResults({ projects: [], issues: [] });
          setPanelOpen(true);
        })
        .finally(() => {
          if (search().trim() === scheduled) {
            setQuickLoading(false);
          }
        });
    }, 220);

    onCleanup(() => window.clearTimeout(timer));
  });

  onMount(() => {
    function onDocPointerDown(ev) {
      const el = searchWrapEl;
      if (!el || !panelOpen()) {
        return;
      }
      const t = ev.target;
      if (t instanceof Node && !el.contains(t)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocPointerDown);
    onCleanup(() => document.removeEventListener("mousedown", onDocPointerDown));
  });

  function goProject(p) {
    const path = projectDetailPath(props.workspacePathPrefix, p.id);
    setSearch("");
    setPanelOpen(false);
    props.navigateTo(path);
  }

  function goIssueByIssuesId(issuesId) {
    const path = issueDetailPath(props.workspacePathPrefix, issuesId);
    props.navigateTo(path);
  }

  function goIssue(i) {
    const id = i?.issuesId ?? i?.issues_id;
    if (!id) {
      return;
    }
    setSearch("");
    setPanelOpen(false);
    goIssueByIssuesId(id);
  }

  function hasQuickHits() {
    const r = quickResults();
    return (r.projects?.length || 0) + (r.issues?.length || 0) > 0;
  }

  const pendingTotal = () => props.myPendingWorkTotal;
  const pendingItems = () => (Array.isArray(props.myPendingWorkItems) ? props.myPendingWorkItems : []);

  const bellNum = () => {
    const n = pendingTotal();
    if (typeof n !== "number" || n <= 0) {
      return 0;
    }
    return Math.min(n, 99);
  };

  return (
    <header class="app-shell-topbar">
      <div
        class="app-shell-search-wrap app-shell-search-wrap--dropdown"
        ref={(el) => {
          searchWrapEl = el;
        }}
      >
        <span class="app-shell-search-ico" aria-hidden="true" />
        <Inp
          variant="borderless"
          class="app-shell-search-inp"
          aria-label="搜索项目与任务编号"
          placeholder="搜索项目、任务编号…"
          value={search()}
          onInput={(e) => setSearch(e.target.value)}
          onFocus={() => {
            if (search().trim() && (hasQuickHits() || quickLoading() || quickErr())) {
              setPanelOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setPanelOpen(false);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (hasQuickHits()) {
                const r = quickResults();
                if (r.issues?.length) {
                  goIssue(r.issues[0]);
                  return;
                }
                if (r.projects?.length) {
                  goProject(r.projects[0]);
                  return;
                }
              }
              dispatchGlobalSearch(search());
            }
          }}
        />

        <Show when={panelOpen() && String(props.workspacePathPrefix || "").trim()}>
          <div class="app-shell-search-dropdown" role="listbox" aria-label="快速搜索结果">
            <Show when={quickLoading()}>
              <div class="app-shell-search-dropdown-row muted">搜索中…</div>
            </Show>
            <Show when={!quickLoading() && quickErr()}>
              <div class="app-shell-search-dropdown-row error-text">{quickErr()}</div>
            </Show>
            <Show when={!quickLoading() && !quickErr() && !hasQuickHits()}>
              <div class="app-shell-search-dropdown-row muted">无匹配项目或任务</div>
            </Show>

            <Show when={!quickLoading() && !quickErr() && quickResults().projects?.length}>
              <div class="app-shell-search-dropdown-section" role="group" aria-label="项目">
                <div class="app-shell-search-dropdown-label">项目</div>
                <For each={quickResults().projects}>
                  {(p) => (
                    <button
                      type="button"
                      class="app-shell-search-dropdown-item"
                      role="option"
                      onClick={() => goProject(p)}
                    >
                      <span class="app-shell-search-dropdown-title">{p.name}</span>
                      <span class="app-shell-search-dropdown-meta">{p.key}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={!quickLoading() && !quickErr() && quickResults().issues?.length}>
              <div class="app-shell-search-dropdown-section" role="group" aria-label="任务">
                <div class="app-shell-search-dropdown-label">任务</div>
                <For each={quickResults().issues}>
                  {(i) => (
                    <button
                      type="button"
                      class="app-shell-search-dropdown-item"
                      role="option"
                      onClick={() => goIssue(i)}
                    >
                      <span class="app-shell-search-dropdown-kicker">{i.issuesId}</span>
                      <span class="app-shell-search-dropdown-title">{i.title}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <div class="app-shell-topbar-tail">
        <Popover
          placement="bottomRight"
          title="待开始 · 进行中"
          content={
            <div class="app-notif-panel">
              <Show when={pendingTotal() == null}>
                <p class="app-notif-body muted">正在加载任务…</p>
              </Show>
              <Show when={typeof pendingTotal() === "number"}>
                <Show
                  when={pendingTotal() === 0}
                  fallback={
                    <>
                      <p class="app-notif-body">
                        指派给你、且为<strong>待开始</strong>或<strong>进行中</strong>的任务共{" "}
                        <strong>{pendingTotal()}</strong> 条；下列为创建时间最早的 5 条。
                      </p>
                      <ul class="app-notif-issue-list">
                        <For each={pendingItems()}>
                          {(row) => (
                            <li>
                              <button
                                type="button"
                                class="app-notif-issue-row"
                                onClick={() => goIssueByIssuesId(row.issues_id)}
                              >
                                <span class="app-notif-issue-id">{row.issues_id}</span>
                                <span class="app-notif-issue-title">{row.title}</span>
                                <span class="app-notif-issue-status">{statusLabel(row.status)}</span>
                              </button>
                            </li>
                          )}
                        </For>
                      </ul>
                    </>
                  }
                >
                  <p class="app-notif-body muted">暂无待开始或进行中的已指派任务。</p>
                </Show>
              </Show>
            </div>
          }
        >
          <button
            type="button"
            class="app-shell-bell-btn"
            aria-label={`任务提醒${bellNum() > 0 ? `，${bellNum()} 条` : ""}`}
          >
            <span class="app-shell-bell-ico" aria-hidden="true" />
            <Show when={bellNum() > 0}>
              <span class="app-shell-bell-badge" aria-hidden="true">
                {bellNum()}
              </span>
            </Show>
          </button>
        </Popover>

        <Dropdown
          items={[
            { label: "我的任务", onClick: () => props.navigateTo(props.myIssuesPath) },
            { label: "Workspace 设置", onClick: () => props.navigateTo(props.workspaceSettingsPath) }
          ]}
        >
          <button
            type="button"
            class="app-shell-user-chip"
            aria-label={`菜单：${displayName()}`}
            aria-haspopup="true"
          >
            <span class="app-shell-user-avatar">{userInitial(displayName())}</span>
            <span class="app-shell-user-name">{displayName()}</span>
            <span class="app-shell-user-chevron" aria-hidden="true">
              ▾
            </span>
          </button>
        </Dropdown>
      </div>
    </header>
  );
}
