import "./App.css";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

const LS_TOKEN_KEY = "ordo_access_token";
const LS_WORKSPACE_KEY = "ordo_current_workspace_id";
/** 每个浏览器标签页内最多做一次「用 token 拉通后端 User」的补救，避免每次刷新都打注册接口 */
const SESSION_BOOTSTRAP_KEY = "ordo_session_bootstrapped";
/** 钉钉 OAuth 会回到 / ，邀请 token 仅存于初次 URL —— 先入 session 再登录，登录后兑付 */
const SESSION_PENDING_WORKSPACE_INVITE_KEY = "ordo_pending_workspace_invite_token";

function acceptWorkspaceInvitePath() {
  return "/accept-workspace-invite";
}

function getWorkspaceInviteTokenFromLocation() {
  try {
    const url = new URL(window.location.href);
    if (url.pathname !== acceptWorkspaceInvitePath()) {
      return "";
    }
    return url.searchParams.get("token")?.trim() || "";
  } catch {
    return "";
  }
}

function stashWorkspaceInviteTokenFromUrlIfPresent() {
  const raw = getWorkspaceInviteTokenFromLocation();
  if (!raw) {
    return;
  }
  try {
    sessionStorage.setItem(SESSION_PENDING_WORKSPACE_INVITE_KEY, raw);
  } catch {
    /* ignore quota / privacy */
  }
}

function readPendingWorkspaceInviteToken() {
  try {
    const fromSession = sessionStorage.getItem(SESSION_PENDING_WORKSPACE_INVITE_KEY);
    if (fromSession && String(fromSession).trim()) {
      return String(fromSession).trim();
    }
  } catch {
    /* ignore */
  }
  return getWorkspaceInviteTokenFromLocation();
}

function clearPendingWorkspaceInviteToken() {
  try {
    sessionStorage.removeItem(SESSION_PENDING_WORKSPACE_INVITE_KEY);
  } catch {
    /* ignore */
  }
}

/** 仅保留登录 token 与当前 workspace id；其余 ordo 前缀的旧版本地数据一律清除 */
function pruneOrdoLocalStorage() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) {
        keys.push(k);
      }
    }
    for (const key of keys) {
      if (key === LS_TOKEN_KEY || key === LS_WORKSPACE_KEY) {
        continue;
      }
      if (key.startsWith("ordo")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore quota / privacy mode */
  }
}
import { Btn, Inp, Modal, Sel } from "./ui/primitives.jsx";
import { apiGet, apiPatch, apiPost } from "./api/client";
import { teamMenuColor } from "./lib/teamMenuColor";
import { findTeamFromUrlSegment, teamSegmentForUrl } from "./lib/teamSlug";
import { DingTalkLogin } from "./features/auth/DingTalkLogin.jsx";
import { ProjectList } from "./features/projects/ProjectList.jsx";
import { IssueList } from "./features/issues/IssueList.jsx";
import { CycleList } from "./features/cycles/CycleList.jsx";
import { TeamSettings } from "./features/teams/TeamSettings.jsx";

function navigateTo(path) {
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function decodeURIComponentSafe(segment) {
  if (segment == null || segment === "") {
    return segment;
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function slugifyWorkspaceUrl(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getWorkspaceUrl(workspace) {
  return workspace?.url || slugifyWorkspaceUrl(workspace?.name) || workspace?.id || "";
}

function buildWorkspacePath(workspace, subPath = "") {
  const workspaceUrl = getWorkspaceUrl(workspace);
  if (!workspaceUrl) {
    return "/";
  }
  const normalizedSubPath = subPath.startsWith("/") ? subPath : subPath ? `/${subPath}` : "";
  return `/${workspaceUrl}${normalizedSubPath}`;
}

function stripWorkspacePrefix(pathname, workspacesList) {
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match) {
    return { workspaceUrl: "", innerPath: pathname };
  }
  const maybeWorkspaceUrl = match[1];
  const workspaceMatched = workspacesList.some((item) => getWorkspaceUrl(item) === maybeWorkspaceUrl);
  if (!workspaceMatched) {
    return { workspaceUrl: "", innerPath: pathname };
  }
  const innerPath = match[2] || "/";
  return { workspaceUrl: maybeWorkspaceUrl, innerPath };
}

/** @returns {{ teamSegment: string, section: string, issueId?: string } | null} */
function parseTeamRoute(innerPathStr) {
  let issueDetail = innerPathStr.match(/^\/workspace\/teams\/([^/]+)\/issues\/([^/]+)$/);
  if (issueDetail) {
    return {
      teamSegment: issueDetail[1],
      section: "issue-detail",
      issueId: decodeURIComponentSafe(issueDetail[2])
    };
  }
  let m = innerPathStr.match(
    /^\/workspace\/teams\/([^/]+)\/(issues|settings|cycles|cycles\/current|cycles\/upcoming)$/
  );
  if (!m) {
    issueDetail = innerPathStr.match(/^\/teams\/([^/]+)\/issues\/([^/]+)$/);
    if (issueDetail) {
      return {
        teamSegment: issueDetail[1],
        section: "issue-detail",
        issueId: decodeURIComponentSafe(issueDetail[2])
      };
    }
    m = innerPathStr.match(/^\/teams\/([^/]+)\/(issues|settings|cycles|cycles\/current|cycles\/upcoming)$/);
    if (!m) {
      return null;
    }
  }
  const teamSegment = m[1];
  const segment = m[2];
  if (segment === "issues") {
    return { teamSegment, section: "issues" };
  }
  if (segment === "settings") {
    return { teamSegment, section: "settings" };
  }
  if (segment === "cycles") {
    return { teamSegment, section: "cycles-all" };
  }
  if (segment === "cycles/current") {
    return { teamSegment, section: "cycles-current" };
  }
  if (segment === "cycles/upcoming") {
    return { teamSegment, section: "cycles-upcoming" };
  }
  return null;
}

function SvgIconProjects() {
  return (
    <svg class="nav-ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
      <path d="M4 5.5 10 3 16 5.5 22 3v13l-6 2.5-6-2.5-6 2.5V5.5z" />
      <path d="M10 3v13M16 5.5v13" />
    </svg>
  );
}

function SvgIconIssues() {
  return (
    <svg class="nav-ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2.25" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

function SvgIconCycle() {
  return (
    <svg class="nav-ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
      <path d="M5.5 8.5A7 7 0 0117 9.95" />
      <path d="M18.5 15.5A7 7 0 017 14.05" />
      <path d="M6 14V9h5" />
      <path d="M18 10v5h-5" />
    </svg>
  );
}

function SvgIconChevronDown() {
  return (
    <svg class="workspace-menu-chevron-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function NavLink(p) {
  return (
    <a
      class={[
        "nav-link-row",
        p.icon ? "" : "nav-link-row--solo-text",
        p.active ? "active" : "",
        p.class || ""
      ]
        .filter(Boolean)
        .join(" ")}
      href={p.href}
      onClick={(event) => {
        event.preventDefault();
        navigateTo(p.href);
      }}
    >
      {p.icon ? (
        <span class="nav-link-icon" aria-hidden="true">
          {p.icon}
        </span>
      ) : null}
      <span class="nav-link-text">{p.children}</span>
    </a>
  );
}

function SideNav(p) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = createSignal(false);
  let wmRoot;

  const teamRoute = () => parseTeamRoute(p.innerPath);
  const routeResolvedTeam = () => {
    const tr = teamRoute();
    const teamsList = p.teams;
    if (!tr?.teamSegment || !teamsList?.length) {
      return null;
    }
    return findTeamFromUrlSegment(teamsList, tr.teamSegment);
  };
  const workspaceRootPath = () => buildWorkspacePath(p.currentWorkspace);
  const projectsActive = () => p.innerPath === "/";

  onMount(() => {
    function docClick(ev) {
      if (!workspaceMenuOpen() || !wmRoot || wmRoot.contains(ev.target)) {
        return;
      }
      setWorkspaceMenuOpen(false);
    }
    const t = window.setTimeout(() => document.addEventListener("click", docClick), 0);
    onCleanup(() => {
      window.clearTimeout(t);
      document.removeEventListener("click", docClick);
    });
  });

  return (
    <aside class="side-nav">
      <div class="side-nav-brand">
        <span class="brand-mark">O</span>
        <span class="brand-name">Ordo</span>
      </div>
      <div class="workspace-menu-wrap" ref={wmRoot}>
        <Btn
          class={[
            "workspace-menu-btn workspace-menu-trigger",
            workspaceMenuOpen() ? "workspace-menu-trigger--open" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          variant="default"
          aria-label={`Workspace 菜单${p.currentWorkspace?.name ? `：${p.currentWorkspace.name}` : ""}`}
          aria-expanded={workspaceMenuOpen()}
          onClick={(ev) => {
            ev.stopPropagation();
            setWorkspaceMenuOpen(!workspaceMenuOpen());
          }}
        >
          <span class="workspace-menu-trigger-name">{p.currentWorkspace?.name || "未选择"}</span>
          <span class="workspace-menu-chevron">
            <SvgIconChevronDown />
          </span>
        </Btn>
        <Show when={workspaceMenuOpen()}>
          <div class="workspace-menu-popup" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                p.onOpenWorkspaceSwitcher();
                setWorkspaceMenuOpen(false);
              }}
            >
              切换 Workspace
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                p.onOpenWorkspaceCreate();
                setWorkspaceMenuOpen(false);
              }}
            >
              新建 Workspace
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                p.onOpenWorkspaceSettings();
                setWorkspaceMenuOpen(false);
              }}
            >
              Workspace settings
            </button>
          </div>
        </Show>
      </div>
      <nav class="side-nav-links">
        <p class="group-title group-title-plain">Workspace</p>
        <NavLink icon={<SvgIconProjects />} href={workspaceRootPath()} active={projectsActive()}>
          Projects
        </NavLink>
        <div class="teams-section">
          <div class="teams-section-header">
            <span class="teams-section-static-title" id="teams-section-heading">
              Your teams
            </span>
            <Btn
              variant="text"
              class="team-add-btn"
              aria-label="Open team actions"
              onClick={() => navigateTo(buildWorkspacePath(p.currentWorkspace, "/settings/teams/new"))}
            >
              +
            </Btn>
          </div>
          <div id="teams-section-list" class="teams-section-body" role="region" aria-labelledby="teams-section-heading">
            <For each={p.teams}>
              {(team) => {
                const isActiveTeam = routeResolvedTeam()?.id === team.id;
                return (
                  <div class="team-block">
                    <button
                      type="button"
                      class="team-title-row"
                      id={`team-heading-${team.id}`}
                      aria-expanded={p.expandedTeamId === team.id}
                      aria-label={`展开团队 ${team.name}`}
                      onClick={() => p.onToggleTeam(team.id)}
                    >
                      <span class="team-name-label" style={{ color: teamMenuColor(team) }}>
                        {team.name}
                      </span>
                      <span class="team-fold-icon">{p.expandedTeamId === team.id ? "▾" : "▸"}</span>
                    </button>
                    <Show when={p.expandedTeamId === team.id}>
                      <>
                        <div class="team-links team-links-peer">
                          <NavLink
                            icon={<SvgIconIssues />}
                            href={buildWorkspacePath(p.currentWorkspace, `/workspace/teams/${teamSegmentForUrl(team)}/issues`)}
                            active={
                              isActiveTeam && (teamRoute()?.section === "issues" || teamRoute()?.section === "issue-detail")
                            }
                          >
                            Issues
                          </NavLink>
                          <NavLink
                            icon={<SvgIconCycle />}
                            href={buildWorkspacePath(p.currentWorkspace, `/workspace/teams/${teamSegmentForUrl(team)}/cycles`)}
                            active={
                              isActiveTeam &&
                              (teamRoute()?.section === "cycles-all" ||
                                teamRoute()?.section === "cycles-current" ||
                                teamRoute()?.section === "cycles-upcoming")
                            }
                          >
                            Cycles
                          </NavLink>
                          <div class="cycle-nav-sub" role="group" aria-label="迭代视图">
                            <a
                              class="cycle-nav-sublink"
                              classList={{
                                active: isActiveTeam && teamRoute()?.section === "cycles-all"
                              }}
                              href={buildWorkspacePath(
                                p.currentWorkspace,
                                `/workspace/teams/${teamSegmentForUrl(team)}/cycles`
                              )}
                              onClick={(event) => {
                                event.preventDefault();
                                navigateTo(
                                  buildWorkspacePath(
                                    p.currentWorkspace,
                                    `/workspace/teams/${teamSegmentForUrl(team)}/cycles`
                                  )
                                );
                              }}
                            >
                              全部
                            </a>
                            <a
                              class="cycle-nav-sublink"
                              classList={{
                                active: isActiveTeam && teamRoute()?.section === "cycles-current"
                              }}
                              href={buildWorkspacePath(
                                p.currentWorkspace,
                                `/workspace/teams/${teamSegmentForUrl(team)}/cycles/current`
                              )}
                              onClick={(event) => {
                                event.preventDefault();
                                navigateTo(
                                  buildWorkspacePath(
                                    p.currentWorkspace,
                                    `/workspace/teams/${teamSegmentForUrl(team)}/cycles/current`
                                  )
                                );
                              }}
                            >
                              当前
                            </a>
                            <a
                              class="cycle-nav-sublink"
                              classList={{
                                active: isActiveTeam && teamRoute()?.section === "cycles-upcoming"
                              }}
                              href={buildWorkspacePath(
                                p.currentWorkspace,
                                `/workspace/teams/${teamSegmentForUrl(team)}/cycles/upcoming`
                              )}
                              onClick={(event) => {
                                event.preventDefault();
                                navigateTo(
                                  buildWorkspacePath(
                                    p.currentWorkspace,
                                    `/workspace/teams/${teamSegmentForUrl(team)}/cycles/upcoming`
                                  )
                                );
                              }}
                            >
                              下个迭代
                            </a>
                          </div>
                        </div>
                        <div class="team-links team-links-settings">
                          <NavLink
                            href={buildWorkspacePath(p.currentWorkspace, `/workspace/teams/${teamSegmentForUrl(team)}/settings`)}
                            active={isActiveTeam && teamRoute()?.section === "settings"}
                          >
                            Team settings
                          </NavLink>
                        </div>
                      </>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </nav>
      <footer class="side-nav-footer">
        <button type="button" class="side-nav-logout-muted" onClick={p.onLogout}>
          退出登录
        </button>
      </footer>
    </aside>
  );
}

function PageHeader(pp) {
  return (
    <header class="page-header">
      <div>
        <h1>{pp.title}</h1>
        {pp.subtitle ? <p class="page-subtitle">{pp.subtitle}</p> : null}
      </div>
    </header>
  );
}

function ProjectHomePage() {
  return (
    <div class="main-area">
      <section class="content page-wrap">
        <PageHeader title="Projects" subtitle="工作区内的项目" />
        <ProjectList />
      </section>
    </div>
  );
}

function TeamCreatePage(pp) {
  const [name, setName] = createSignal("");
  const [identifier, setIdentifier] = createSignal("");
  const [parentTeamId, setParentTeamId] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!name().trim()) {
      setError("请输入 Team 名称");
      return;
    }
    if (!identifier().trim()) {
      setError("请输入 Identifier");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const team = await apiPost("/api/teams", {
        name: name().trim(),
        workspaceId: pp.workspaceId,
        identifier: identifier().trim().toUpperCase(),
        parentTeamId: parentTeamId() || undefined
      });
      pp.onTeamCreated(team);
      pp.onCreatedMessage(`Team "${team.name}" 创建成功`);
      navigateTo(`${pp.workspacePathPrefix}/workspace/teams/${teamSegmentForUrl(team)}/settings`);
    } catch (err) {
      if (err?.status === 409) {
        setError("Team 名称已存在");
      } else {
        setError("创建 Team 失败");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="main-area">
      <section class="content team-create-page page-wrap">
        <h1>Create a new team</h1>
        <p class="sub-title">Create a new team to manage separate cycles, workflows and notifications</p>
        <form class="team-create-card surface-card" onSubmit={handleSubmit}>
          <div class="team-field-row">
            <label for="team-icon">Team icon</label>
            <Btn id="team-icon" variant="default" class="team-icon-btn" aria-label="Team icon">
              ☐
            </Btn>
          </div>
          <div class="team-field-row">
            <label for="team-name-input">Team name</label>
            <Inp
              id="team-name-input"
              aria-label="Team name"
              placeholder="e.g. Engineering"
              value={name()}
              onInput={(event) => setName(event.target.value)}
            />
          </div>
          <div class="team-field-row">
            <label for="team-identifier-input">Identifier</label>
            <Inp
              id="team-identifier-input"
              aria-label="Identifier"
              placeholder="e.g. ENG"
              value={identifier()}
              onInput={(event) => setIdentifier(event.target.value)}
            />
          </div>
          <section class="team-hierarchy">
            <h2>Team hierarchy</h2>
            <p>Teams can be nested to reflect your team structure and to share workflows and settings</p>
            <div class="team-field-row team-parent-row">
              <label for="parent-team-select">Parent team</label>
              <Sel
                id="parent-team-select"
                aria-label="Parent team"
                value={parentTeamId()}
                onChange={(value) => setParentTeamId(value)}
                options={[
                  { value: "", label: "No parent team" },
                  ...pp.teams.map((team) => ({ value: team.id, label: team.name }))
                ]}
              />
            </div>
          </section>
          {error() ? <p class="error-text">{error()}</p> : null}
          <Btn class="create-team-submit" variant="primary" htmlType="submit" loading={saving()} disabled={saving()}>
            {saving() ? "Creating..." : "Create team"}
          </Btn>
        </form>
      </section>
    </div>
  );
}

function WorkspaceCreateForm(pp) {
  const [name, setName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal("");
  let inputRef;

  onMount(() => {
    if (pp.focusOnMount !== false) {
      inputRef?.focus?.();
    }
  });

  async function handleCreate(event) {
    event.preventDefault();
    if (!name().trim()) {
      setError("请输入 Workspace 名称");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const workspace = await apiPost("/api/workspaces", { name: name().trim() });
      pp.onCreated(workspace);
      setName("");
    } catch (err) {
      if (err?.status === 409) {
        setError("Workspace 名称已存在，请换一个名字");
      } else {
        setError("创建 Workspace 失败，请稍后重试");
      }
    } finally {
      setCreating(false);
    }
  }

  const compact = pp.compact;

  return (
    <>
      <form onSubmit={handleCreate} class={compact ? "create-workspace-form create-workspace-form--compact" : "create-workspace-form"}>
        <Inp
          ref={inputRef}
          value={name()}
          onInput={(event) => setName(event.target.value)}
          placeholder={compact ? "Workspace 名称" : "例如：trex"}
          aria-label="Workspace name"
        />
        <Btn variant="primary" htmlType="submit" loading={creating()} disabled={creating()}>
          {creating() ? "创建中..." : compact ? "创建" : "创建 Workspace"}
        </Btn>
      </form>
      {error() ? <p class="error-text">{error()}</p> : null}
    </>
  );
}

function CreateWorkspacePanel(pp) {
  return (
    <section class="empty-state surface-card auth-card">
      <h2>你还没有 Workspace</h2>
      <p class="muted">请输入一个 Workspace 名称开始使用。</p>
      <WorkspaceCreateForm onCreated={pp.onCreated} />
    </section>
  );
}

function WorkspaceSettingsPage(pp) {
  const cw = pp.currentWorkspace;
  const [name, setName] = createSignal(cw?.name || "");
  const [urlField, setUrlField] = createSignal(getWorkspaceUrl(cw));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  createEffect(() => {
    const w = pp.currentWorkspace;
    setName(w?.name || "");
    setUrlField(getWorkspaceUrl(w));
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (!pp.currentWorkspace?.id) {
      return;
    }
    if (!name().trim()) {
      setError("请输入 workspace 名称");
      return;
    }
    if (!slugifyWorkspaceUrl(urlField())) {
      setError("请输入合法的 url（小写字母、数字、-）");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const updated = await apiPatch(`/api/workspaces/${pp.currentWorkspace.id}`, {
        name: name().trim(),
        url: slugifyWorkspaceUrl(urlField())
      });
      pp.onUpdated(updated);
    } catch (err) {
      if (err?.status === 409) {
        setError("workspace 名称或 url 已存在");
      } else {
        setError("更新 workspace 失败");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="main-area">
      <section class="content page-wrap workspace-settings-layout">
        <PageHeader title="Workspace settings" subtitle={pp.currentWorkspace?.name || "当前工作区"} />
        <div class="workspace-settings-card surface-card flat-top">
          <h2 class="workspace-settings-card-title">基本信息</h2>
          <p class="workspace-settings-card-desc muted">在此修改工作区的显示名称与网址路径前缀。</p>
          <form class="workspace-settings-form" onSubmit={handleSubmit}>
            <label class="workspace-settings-field">
              <span class="workspace-settings-label">名称</span>
              <div class="workspace-settings-control">
                <Inp
                  class="workspace-settings-inp-grow"
                  aria-label="Workspace settings name"
                  value={name()}
                  onInput={(event) => setName(event.target.value)}
                  placeholder="工作区名称"
                />
              </div>
            </label>
            <label class="workspace-settings-field">
              <span class="workspace-settings-label">网址路径</span>
              <div class="workspace-settings-control">
                <Inp
                  class="workspace-settings-inp-grow"
                  aria-label="Workspace settings url"
                  value={urlField()}
                  addonBefore="/"
                  onInput={(event) => setUrlField(event.target.value)}
                  placeholder="如 trex-team"
                />
              </div>
            </label>
            {error() ? <p class="error-text workspace-settings-error">{error()}</p> : null}
            <div class="workspace-settings-actions">
              <Btn variant="primary" htmlType="submit" loading={saving()}>
                保存
              </Btn>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [pathname, setPathname] = createSignal(window.location.pathname);
  const [workspaces, setWorkspaces] = createSignal([]);
  const [workspaceId, setWorkspaceId] = createSignal(localStorage.getItem(LS_WORKSPACE_KEY) || "");
  const [teams, setTeams] = createSignal([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = createSignal(true);
  const [loggedIn, setLoggedIn] = createSignal(Boolean(localStorage.getItem(LS_TOKEN_KEY)));
  const [flashMessage, setFlashMessage] = createSignal("");
  const [authError, setAuthError] = createSignal("");
  const [expandedTeamId, setExpandedTeamId] = createSignal("");
  const [workspaceSwitchOpen, setWorkspaceSwitchOpen] = createSignal(false);
  const [pendingWorkspaceId, setPendingWorkspaceId] = createSignal("");
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = createSignal(false);

  createEffect(() => {
    pathname();
    stashWorkspaceInviteTokenFromUrlIfPresent();
  });

  /** 避免登录态 createEffect 与 OAuth 完成回调重复兑付同一张邀请 */
  let workspaceInviteFinalizeInFlight = false;

  /**
   * 用当前 localStorage 中的 access token 调用接受邀请，并切到对应 Workspace。
   * @returns {Promise<boolean>} 是否处理过待兑付邀请（含失败，避免外层再 replace 到无关 URL）
   */
  async function runPendingWorkspaceInviteAfterAuth() {
    const token = readPendingWorkspaceInviteToken();
    if (!token) {
      return false;
    }
    try {
      const body = await apiGet(`/api/workspace-invites/accept?token=${encodeURIComponent(token)}`);
      clearPendingWorkspaceInviteToken();
      const mines = await apiGet("/api/workspaces/mine");
      const items = mines?.items || [];
      setWorkspaces(items);
      const wid = body.workspaceId;
      if (wid) {
        setWorkspaceId(wid);
      }
      setLoadingWorkspaces(false);
      const wsObj = items.find((w) => w.id === wid);
      const targetPath = wsObj ? buildWorkspacePath(wsObj) : "/";
      window.history.replaceState({}, "", targetPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return true;
    } catch (err) {
      clearPendingWorkspaceInviteToken();
      setFlashMessage(
        err?.status === 410
          ? "邀请链接已过期"
          : err?.status === 404
            ? "邀请链接无效"
            : err?.status === 409
              ? "邀请当前无法使用（状态冲突）"
              : "无法接受工作区邀请，请稍后重试"
      );
      try {
        const mines = await apiGet("/api/workspaces/mine");
        const items = mines?.items || [];
        setWorkspaces(items);
        setWorkspaceId(items[0]?.id || "");
        setLoadingWorkspaces(false);
      } catch {
        setLoadingWorkspaces(false);
      }
      window.history.replaceState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return true;
    }
  }

  function handleAuthExpired() {
    try {
      sessionStorage.removeItem(SESSION_BOOTSTRAP_KEY);
    } catch {
      /* ignore */
    }
    localStorage.removeItem(LS_TOKEN_KEY);
    localStorage.removeItem(LS_WORKSPACE_KEY);
    setLoggedIn(false);
    setWorkspaces([]);
    setWorkspaceId("");
    setTeams([]);
  }

  onMount(() => {
    const url = new URL(window.location.href);
    const accessToken = url.searchParams.get("accessToken");
    if (!accessToken) {
      return;
    }
    /** 后端 OAuth 回调可能只把 token 带到前端 URL，这里必须调注册/同步接口，否则 User 表可能从未写入 */
    apiPost("/api/auth/dingtalk", { idToken: accessToken })
      .then((data) => {
        localStorage.setItem(LS_TOKEN_KEY, data.accessToken);
        try {
          sessionStorage.setItem(SESSION_BOOTSTRAP_KEY, "1");
        } catch {
          /* ignore */
        }
        pruneOrdoLocalStorage();
        url.searchParams.delete("accessToken");
        window.history.replaceState({}, "", url.pathname + (url.search || ""));
        setLoggedIn(true);
      })
      .catch(() => {
        setAuthError("登录状态同步失败，请重新登录");
        setLoggedIn(false);
      });
  });

  onMount(() => {
    const url = new URL(window.location.href);
    const isCallbackPath = url.pathname === "/dingtalk/callback";
    const authCode = url.searchParams.get("authCode") || url.searchParams.get("code");
    if (!isCallbackPath || !authCode) {
      return;
    }
    const redirectUri = `${window.location.origin}/dingtalk/callback`;
    apiPost("/api/auth/dingtalk/exchange-code", { authCode, redirectUri })
      .then((data) => {
        localStorage.setItem(LS_TOKEN_KEY, data.accessToken);
        localStorage.removeItem(LS_WORKSPACE_KEY);
        try {
          sessionStorage.setItem(SESSION_BOOTSTRAP_KEY, "1");
        } catch {
          /* ignore */
        }
        pruneOrdoLocalStorage();
        setAuthError("");
        setLoggedIn(true);
        /** 待定邀请兑付前保留 URL，由 createEffect 调用 accept 后再 replace（无邀请则回首页） */
        if (!readPendingWorkspaceInviteToken()) {
          window.history.replaceState({}, "", "/");
        }
      })
      .catch(() => {
        setAuthError("钉钉登录失败，请重试");
        setLoggedIn(false);
      });
  });

  onMount(() => {
    const handleRouteChange = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handleRouteChange);
    onCleanup(() => window.removeEventListener("popstate", handleRouteChange));
  });

  onMount(() => {
    pruneOrdoLocalStorage();
  });

  /** 已有本地 token 时补一次服务端静默注册（换库清空、仅存 token 等情况） */
  onMount(() => {
    const token = localStorage.getItem(LS_TOKEN_KEY);
    let skip = false;
    try {
      skip = Boolean(sessionStorage.getItem(SESSION_BOOTSTRAP_KEY));
    } catch {
      skip = false;
    }
    if (!token || skip) {
      return;
    }
    const url = new URL(window.location.href);
    if (url.pathname === "/dingtalk/callback" && (url.searchParams.get("authCode") || url.searchParams.get("code"))) {
      return;
    }
    if (url.searchParams.get("accessToken")) {
      return;
    }
    apiPost("/api/auth/dingtalk", { idToken: token }).then(
      () => {
        try {
          sessionStorage.setItem(SESSION_BOOTSTRAP_KEY, "1");
        } catch {
          /* ignore */
        }
      },
      (err) => {
        console.error("[ordo] 静默注册失败（/User 不会写入）：", err?.message || err);
      }
    );
  });

  createEffect(() => {
    const li = loggedIn();
    if (!li) {
      setLoadingWorkspaces(false);
      setWorkspaces([]);
      setWorkspaceId("");
      return;
    }
    /** 等待邀请兑付写入成员关系后再拉列表，否则与 accept 并发会短暂缺少新 Workspace */
    if (readPendingWorkspaceInviteToken()) {
      setLoadingWorkspaces(true);
      return;
    }
    let active = true;
    setLoadingWorkspaces(true);
    apiGet("/api/workspaces/mine")
      .then((data) => {
        if (!active) {
          return;
        }
        const items = data?.items || [];
        setWorkspaces(items);
        const existing = items.find((item) => item.id === localStorage.getItem(LS_WORKSPACE_KEY));
        const nextWorkspaceId = existing?.id || items[0]?.id || "";
        setWorkspaceId(nextWorkspaceId);
        setLoadingWorkspaces(false);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        if (err?.status === 401 || /Invalid idToken/i.test(err?.message || "")) {
          handleAuthExpired();
          return;
        }
        setLoadingWorkspaces(false);
        setWorkspaces([]);
      });
    onCleanup(() => {
      active = false;
    });
  });

  createEffect(() => {
    if (!loggedIn()) {
      return;
    }
    const token = readPendingWorkspaceInviteToken();
    if (!token) {
      return;
    }
    if (workspaceInviteFinalizeInFlight) {
      return;
    }
    workspaceInviteFinalizeInFlight = true;
    void runPendingWorkspaceInviteAfterAuth().finally(() => {
      workspaceInviteFinalizeInFlight = false;
    });
  });

  createEffect(() => {
    const wid = workspaceId();
    if (!wid) {
      setTeams([]);
      return;
    }

    let active = true;
    localStorage.setItem(LS_WORKSPACE_KEY, wid);
    apiGet(`/api/teams?workspaceId=${encodeURIComponent(wid)}`)
      .then((data) => {
        if (active) {
          setTeams(data?.items || []);
        }
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        if (err?.status === 401 || /Invalid idToken/i.test(err?.message || "")) {
          handleAuthExpired();
          return;
        }
        setTeams([]);
      });
    onCleanup(() => {
      active = false;
    });
  });

  const pathInfo = createMemo(() => stripWorkspacePrefix(pathname(), workspaces()));
  const innerPath = () => pathInfo().innerPath;

  const activeWorkspaceByPath = () =>
    workspaces().find((item) => getWorkspaceUrl(item) === pathInfo().workspaceUrl);

  const teamRoute = () => parseTeamRoute(innerPath());
  const currentWorkspace = () => workspaces().find((item) => item.id === workspaceId()) || null;

  const isCreateTeam = () => innerPath().startsWith("/settings/teams/new");
  const isWorkspaceSettings = () => innerPath() === "/settings/workspaces";

  createEffect(() => {
    if (!loggedIn() || loadingWorkspaces() || workspaces().length === 0) {
      return;
    }
    if (innerPath() !== "/settings/workspaces/new") {
      return;
    }
    setWorkspaceCreateOpen(true);
    const cw = currentWorkspace();
    const target = buildWorkspacePath(cw || workspaces()[0]);
    if (window.location.pathname !== target) {
      navigateTo(target);
    }
  });

  createEffect(() => {
    if (innerPath() !== "/settings/teams") {
      return;
    }
    const t = teams();
    if (t.length === 0) {
      return;
    }
    navigateTo(buildWorkspacePath(currentWorkspace(), `/workspace/teams/${teamSegmentForUrl(t[0])}/settings`));
  });

  createEffect(() => {
    const ws = workspaces();
    const wid = workspaceId();
    const awbp = activeWorkspaceByPath();
    const pinfo = pathInfo();
    const cw = currentWorkspace();
    const pn = pathname();
    if (!ws.length || !wid) {
      return;
    }
    if (awbp && awbp.id !== wid) {
      setWorkspaceId(awbp.id);
      return;
    }
    if (!pinfo.workspaceUrl) {
      if (import.meta.env.MODE === "test") {
        return;
      }
      /** 兑付邀请前应停留在邀请页并完成 accept，不能被强制拉回默认 Workspace */
      if (pn === acceptWorkspaceInvitePath() || pn.startsWith(`${acceptWorkspaceInvitePath()}?`)) {
        return;
      }
      const target = buildWorkspacePath(cw);
      if (target !== pn) {
        navigateTo(target);
      }
    }
  });

  createEffect(() => {
    if (expandedTeamId() && !teams().some((team) => team.id === expandedTeamId())) {
      setExpandedTeamId("");
    }
  });

  createEffect(() => {
    const tr = teamRoute();
    const t = teams();
    if (!tr?.teamSegment || !t.length) {
      return;
    }
    const resolved = findTeamFromUrlSegment(t, tr.teamSegment);
    if (!resolved) {
      return;
    }
    if (!expandedTeamId()) {
      setExpandedTeamId(resolved.id);
    }
  });

  function handleLogout() {
    handleAuthExpired();
    navigateTo("/");
  }

  function handleWorkspaceCreated(workspace) {
    setWorkspaces((prev) => [...prev, workspace]);
    setWorkspaceId(workspace.id);
    setFlashMessage(`Workspace "${workspace.name}" 创建成功`);
    navigateTo(buildWorkspacePath(workspace));
  }

  function handleTeamCreated(team) {
    setTeams((prev) => [...prev, team]);
  }

  function handleWorkspaceSwitch(nextWorkspaceId) {
    if (!nextWorkspaceId) {
      return;
    }
    setWorkspaceId(nextWorkspaceId);
    setWorkspaceSwitchOpen(false);
    setPendingWorkspaceId("");
    const nextWorkspace = workspaces().find((item) => item.id === nextWorkspaceId);
    const targetPath = buildWorkspacePath(nextWorkspace);
    if (import.meta.env.MODE !== "test") {
      window.location.assign(targetPath);
      return;
    }
    navigateTo(targetPath);
  }

  function handleWorkspaceUpdated(updatedWorkspace) {
    setWorkspaces((prev) => prev.map((item) => (item.id === updatedWorkspace.id ? { ...item, ...updatedWorkspace } : item)));
    setFlashMessage(`Workspace "${updatedWorkspace.name}" 已更新`);
    navigateTo(buildWorkspacePath(updatedWorkspace, "/settings/workspaces"));
  }

  createEffect(() => {
    const fm = flashMessage();
    if (!fm) {
      return;
    }
    const timer = window.setTimeout(() => setFlashMessage(""), 2500);
    onCleanup(() => window.clearTimeout(timer));
  });

  function renderMain() {
    if (isCreateTeam()) {
      return (
        <TeamCreatePage
          workspaceId={workspaceId()}
          workspacePathPrefix={buildWorkspacePath(currentWorkspace())}
          teams={teams()}
          onTeamCreated={handleTeamCreated}
          onCreatedMessage={(msg) => setFlashMessage(msg)}
        />
      );
    }

    if (isWorkspaceSettings()) {
      return <WorkspaceSettingsPage currentWorkspace={currentWorkspace()} onUpdated={handleWorkspaceUpdated} />;
    }

    const tr = teamRoute();
    if (tr) {
      const team = findTeamFromUrlSegment(teams(), tr.teamSegment);
      if (!team) {
        return (
          <div class="main-area">
            <section class="content page-wrap">
              <p class="muted">未找到该团队，请从侧栏选择。</p>
            </section>
          </div>
        );
      }

      if (tr.section === "issues") {
        return (
          <div class="main-area">
            <section class="content page-wrap">
              <PageHeader title="Issues" subtitle={team.name} />
              <IssueList
                teamId={team.id}
                teamName={team.name}
                workspaceId={workspaceId()}
                workspacePathPrefix={buildWorkspacePath(currentWorkspace())}
              />
            </section>
          </div>
        );
      }

      if (tr.section === "issue-detail") {
        return (
          <div class="main-area">
            <section class="content page-wrap issue-detail-route">
              <IssueList
                teamId={team.id}
                teamName={team.name}
                workspaceId={workspaceId()}
                issueId={tr.issueId}
                workspacePathPrefix={buildWorkspacePath(currentWorkspace())}
              />
            </section>
          </div>
        );
      }

      if (
        tr.section === "cycles-all" ||
        tr.section === "cycles-current" ||
        tr.section === "cycles-upcoming"
      ) {
        const cycleView =
          tr.section === "cycles-current" ? "current" : tr.section === "cycles-upcoming" ? "upcoming" : "all";
        const cyclePageTitle =
          tr.section === "cycles-current" ? "当前迭代" : tr.section === "cycles-upcoming" ? "下个迭代" : "迭代";
        return (
          <div class="main-area">
            <section class="content page-wrap cycle-page-wrap">
              <PageHeader title={cyclePageTitle} subtitle={team.name} />
              <CycleList teamId={team.id} cycleView={cycleView} title={cyclePageTitle} />
            </section>
          </div>
        );
      }

      if (tr.section === "settings") {
        return (
          <div class="main-area">
            <TeamSettings
              workspaceId={workspaceId()}
              team={team}
              onTeamUpdated={(updated) =>
                setTeams((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
              }
              onFlash={(msg) => setFlashMessage(msg)}
            />
          </div>
        );
      }
    }

    return <ProjectHomePage />;
  }

  return (
    <Show
      when={loggedIn()}
      fallback={
        <main class="auth-layout auth-layout--splash">
          <div class="auth-splash-bg" aria-hidden />
          <div class="auth-splash-inner">
            <div class="splash-brand">
              <span class="splash-logo-mark">O</span>
              <div class="splash-brand-text">
                <span class="splash-logo-word">Ordo</span>
                <span class="splash-tagline">项目 · 团队 · 迭代</span>
              </div>
            </div>
            <DingTalkLogin />
            {authError() ? <p class="error-text auth-error-banner">{authError()}</p> : null}
          </div>
        </main>
      }
    >
      <Show when={loadingWorkspaces()}>
        <main class="auth-layout auth-layout--splash">
          <div class="auth-splash-bg" aria-hidden />
          <div class="auth-splash-inner auth-splash-inner--narrow">
            <div class="splash-brand splash-brand--compact">
              <span class="splash-logo-mark">O</span>
              <span class="splash-logo-word">Ordo</span>
            </div>
            <div class="auth-loading-card">
              <div class="auth-loading-dots" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <p class="auth-loading-text">加载 Workspace...</p>
            </div>
          </div>
        </main>
      </Show>

      <Show when={!loadingWorkspaces() && workspaces().length === 0}>
        <main class="auth-layout auth-layout--splash">
          <div class="auth-splash-bg" aria-hidden />
          <div class="auth-splash-inner">
            <div class="splash-brand">
              <span class="splash-logo-mark">O</span>
              <div class="splash-brand-text">
                <span class="splash-logo-word">Ordo</span>
                <span class="splash-tagline">创建你的第一个工作区</span>
              </div>
            </div>
            <CreateWorkspacePanel onCreated={handleWorkspaceCreated} />
          </div>
        </main>
      </Show>

      <Show when={!loadingWorkspaces() && workspaces().length > 0}>
        <main class="app-shell">
          {flashMessage() ? <div class="flash-message">{flashMessage()}</div> : null}
          <SideNav
            innerPath={innerPath()}
            currentWorkspace={currentWorkspace()}
            workspaceId={workspaceId()}
            teams={teams()}
            onLogout={handleLogout}
            expandedTeamId={expandedTeamId()}
            onToggleTeam={(teamIdArg) =>
              setExpandedTeamId((prev) => (prev === teamIdArg ? "" : teamIdArg))
            }
            onOpenWorkspaceSwitcher={() => {
              setPendingWorkspaceId(workspaceId());
              setWorkspaceSwitchOpen(true);
            }}
            onOpenWorkspaceCreate={() => {
              setWorkspaceCreateOpen(true);
            }}
            onOpenWorkspaceSettings={() =>
              navigateTo(buildWorkspacePath(currentWorkspace(), "/settings/workspaces"))
            }
          />
          {renderMain()}
          <Modal
            open={workspaceSwitchOpen()}
            title="选择 Workspace"
            onClose={() => setWorkspaceSwitchOpen(false)}
            footer={
              <>
                <Btn variant="default" onClick={() => setWorkspaceSwitchOpen(false)}>
                  关闭
                </Btn>
                <Btn variant="primary" onClick={() => handleWorkspaceSwitch(pendingWorkspaceId())}>
                  确认切换
                </Btn>
              </>
            }
          >
            <div class="workspace-switch-radio-group">
              <For each={workspaces()}>
                {(workspace) => (
                  <label>
                    <input
                      type="radio"
                      name="workspace-switch-group"
                      value={workspace.id}
                      checked={pendingWorkspaceId() === workspace.id}
                      onChange={() => setPendingWorkspaceId(workspace.id)}
                    />
                    {workspace.name}
                  </label>
                )}
              </For>
            </div>
          </Modal>
          <Modal open={workspaceCreateOpen()} title="新建 Workspace" onClose={() => setWorkspaceCreateOpen(false)}>
            <WorkspaceCreateForm
              compact
              focusOnMount
              onCreated={(workspace) => {
                handleWorkspaceCreated(workspace);
                setWorkspaceCreateOpen(false);
              }}
            />
          </Modal>
        </main>
      </Show>
    </Show>
  );
}
