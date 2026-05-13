import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import { apiGet, apiPatch, apiPost } from "../../api/client";
import { WEEKDAY_OPTIONS_JS, previewTeamIterations } from "../../lib/teamCyclePreview";
import { Btn, Inp, Sel, ToggleSwitch } from "../../ui/primitives.jsx";

const TABS = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "labels", label: "Issue labels" },
  { id: "statuses", label: "Issue statuses" },
  { id: "cycles", label: "Cycle" },
  { id: "workflow", label: "Workflow" },
  { id: "notifications", label: "Notifications" }
];

function emptyLabel() {
  return { name: "", color: "#64748b" };
}

function emptyStatus() {
  return { key: "", label: "" };
}

function emptyBranchRule() {
  return {
    targetBranchRegex: "^devreview_.*",
    rules: {}
  };
}

export function TeamSettings(props) {
  const workspaceId = () => props.workspaceId || "";
  const team = () => props.team || null;

  const [tab, setTab] = createSignal("general");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const [name, setName] = createSignal("");
  const [identifier, setIdentifier] = createSignal("");
  const [accentColor, setAccentColor] = createSignal("");
  const [iterationDays, setIterationDays] = createSignal("14");
  const [cooldownDays, setCooldownDays] = createSignal("2");
  const [startWeekday, setStartWeekday] = createSignal("1");
  const [autoCreateDailyCycles, setAutoCreateDailyCycles] = createSignal(true);
  const [inviteBusy, setInviteBusy] = createSignal(false);
  const [inviteLink, setInviteLink] = createSignal("");
  const [inviteExpires, setInviteExpires] = createSignal("");
  const [inviteErr, setInviteErr] = createSignal("");
  const [copyHint, setCopyHint] = createSignal("");
  const [labels, setLabels] = createSignal([emptyLabel()]);
  const [statuses, setStatuses] = createSignal([emptyStatus()]);
  const [members, setMembers] = createSignal([]);
  const [workflow, setWorkflow] = createSignal({
    gitlab: {
      enabled: false,
      secret: "",
      rules: {
        onDraftOpen: "in_progress",
        onPrOpen: "in_progress",
        onPrActivity: "in_progress",
        onReadyForMerge: "in_review",
        onMerge: "done"
      },
      branchRules: []
    }
  });
  const [notifications, setNotifications] = createSignal({
    dingtalk: {
      enabled: false,
      botWebhookUrl: "",
      botSecret: ""
    }
  });

  async function hydrate() {
    const tid = team()?.id;
    const wid = workspaceId();
    if (!wid) {
      setLoading(false);
      setError("缺少工作区上下文，请从侧栏重新选择 Workspace。");
      return;
    }
    if (!tid) {
      setLoading(false);
      setError("无法解析当前团队，请返回侧栏重新进入。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const full = await apiGet(`/api/teams/${encodeURIComponent(tid)}?workspaceId=${encodeURIComponent(wid)}`);
      setName(full.name || "");
      setIdentifier(full.identifier || "");
      setAccentColor(full.accentColor || "#4f46e5");
      setIterationDays(String(full.iterationDurationDays ?? 14));
      setCooldownDays(String(full.cooldownDays ?? 2));
      setStartWeekday(String(full.iterationStartWeekday ?? 1));
      setAutoCreateDailyCycles(full.autoCreateDailyCycles !== false);
      const lbs = Array.isArray(full.issueLabels) && full.issueLabels.length ? full.issueLabels : [{ name: "", color: "#94a3b8" }];
      setLabels(lbs);
      const sts = Array.isArray(full.issueStatuses) && full.issueStatuses.length ? full.issueStatuses : [{ key: "", label: "" }];
      setStatuses(sts);
      if (full.workflowAutomations && typeof full.workflowAutomations === "object") {
        setWorkflow(full.workflowAutomations);
      }
      if (full.notificationSettings && typeof full.notificationSettings === "object") {
        setNotifications(full.notificationSettings);
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "加载团队设置失败");
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    team()?.id;
    workspaceId();
    void hydrate();
  });

  async function reloadMembers() {
    const wid = workspaceId();
    if (!wid) {
      return;
    }
    try {
      const data = await apiGet(`/api/workspaces/${wid}/members`);
      setMembers(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* ignore tab optional */
    }
  }

  createEffect(() => {
    if (tab() !== "members") {
      return;
    }
    void reloadMembers();
  });

  async function persist(partial, msg) {
    const tid = team()?.id;
    const wid = workspaceId();
    if (!tid || !wid) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await apiPatch(`/api/teams/${encodeURIComponent(tid)}?workspaceId=${encodeURIComponent(wid)}`, partial);
      props.onTeamUpdated?.(updated);
      if (msg) {
        props.onFlash?.(msg);
      }
      return updated;
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveGeneral(ev) {
    ev?.preventDefault?.();
    const n = name().trim();
    if (!n) {
      setError("团队名称不能为空");
      return;
    }
    await persist(
      {
        name: n,
        identifier: identifier().trim(),
        accentColor: accentColor().trim() || null
      },
      "团队信息已更新"
    );
  }

  async function saveLabels(ev) {
    ev?.preventDefault?.();
    const cleaned = labels()
      .map((row) => ({ name: String(row.name || "").trim(), color: String(row.color || "").trim() || "#64748b" }))
      .filter((row) => row.name);
    if (!cleaned.length) {
      setError("至少保留一条标签");
      return;
    }
    await persist({ issueLabels: cleaned }, "Issue labels 已保存");
  }

  async function saveStatuses(ev) {
    ev?.preventDefault?.();
    const cleaned = statuses()
      .map((row) => ({
        key: String(row.key || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_"),
        label: String(row.label || "").trim()
      }))
      .filter((row) => row.key && row.label);
    if (!cleaned.length) {
      setError("至少保留一个状态（key + 名称）");
      return;
    }
    await persist({ issueStatuses: cleaned }, "Issue statuses 已保存");
  }

  async function saveCycleSettings(ev) {
    ev?.preventDefault?.();
    const it = Number(iterationDays());
    const cd = Number(cooldownDays());
    const dow = Number(startWeekday());
    await persist(
      {
        iterationDurationDays: it,
        cooldownDays: cd,
        iterationStartWeekday: Number.isFinite(dow) ? Math.min(6, Math.max(0, Math.round(dow))) : 1,
        autoCreateDailyCycles: Boolean(autoCreateDailyCycles())
      },
      "Cycle 设置已保存"
    );
  }

  async function saveWorkflow(ev) {
    ev?.preventDefault?.();
    await persist({ workflowAutomations: workflow() }, "Workflow 已保存");
  }

  async function saveNotifications(ev) {
    ev?.preventDefault?.();
    const dt = notifications()?.dingtalk || {};
    const cleaned = {
      ...notifications(),
      dingtalk: {
        enabled: Boolean(dt.enabled),
        botWebhookUrl: String(dt.botWebhookUrl || "").trim(),
        botSecret: String(dt.botSecret || "").trim()
      }
    };
    setNotifications(cleaned);
    await persist({ notificationSettings: cleaned }, "Notifications 已保存");
  }

  const cyclePreviewRows = createMemo(() =>
    previewTeamIterations({
      startWeekday: Number(startWeekday()),
      durationDays: Number(iterationDays()),
      cooldownDays: Number(cooldownDays()),
      count: 3
    })
  );

  function fmtDay(d) {
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  }

  async function createWorkspaceInviteLink() {
    const wid = workspaceId();
    if (!wid) {
      setInviteErr("缺少工作区");
      return;
    }
    setInviteBusy(true);
    setInviteErr("");
    setCopyHint("");
    try {
      const tid = team()?.id;
      const data = await apiPost(`/api/workspaces/${encodeURIComponent(wid)}/invites`, {
        role: "member",
        ...(tid ? { contextTeamId: tid } : {})
      });
      setInviteLink(typeof data.inviteLink === "string" ? data.inviteLink : "");
      setInviteExpires(typeof data.expiresAt === "string" ? data.expiresAt : "");
    } catch (e) {
      setInviteErr(e instanceof Error && e.message ? e.message : "生成邀请链接失败");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    const t = inviteLink();
    if (!t) {
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
      setCopyHint("已复制");
      window.setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("复制失败，请手动选择链接");
    }
  }

  function updateLabel(index, field, val) {
    setLabels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  }

  function updateStatus(index, field, val) {
    setStatuses((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  }

  function updateWorkflowGitlab(patch) {
    setWorkflow((prev) => ({ ...prev, gitlab: { ...(prev?.gitlab || {}), ...patch } }));
  }

  function updateWorkflowRules(patch) {
    setWorkflow((prev) => ({
      ...prev,
      gitlab: { ...(prev?.gitlab || {}), rules: { ...((prev?.gitlab || {}).rules || {}), ...patch } }
    }));
  }

  function updateBranchRule(index, patch) {
    setWorkflow((prev) => {
      const gl = prev?.gitlab || {};
      const list = Array.isArray(gl.branchRules) ? gl.branchRules : [];
      const next = [...list];
      next[index] = { ...next[index], ...patch };
      return { ...prev, gitlab: { ...gl, branchRules: next } };
    });
  }

  function updateBranchRuleRules(index, patch) {
    setWorkflow((prev) => {
      const gl = prev?.gitlab || {};
      const list = Array.isArray(gl.branchRules) ? gl.branchRules : [];
      const next = [...list];
      const cur = next[index] || emptyBranchRule();
      next[index] = { ...cur, rules: { ...(cur.rules || {}), ...patch } };
      return { ...prev, gitlab: { ...gl, branchRules: next } };
    });
  }

  function webhookUrl() {
    const tid = team()?.id || "";
    if (!tid) return "";
    const base = window.location.origin;
    return `${base}/api/integrations/gitlab/webhook/${encodeURIComponent(tid)}`;
  }

  function updateDingTalk(patch) {
    setNotifications((prev) => ({ ...prev, dingtalk: { ...(prev?.dingtalk || {}), ...patch } }));
  }

  const WORKFLOW_STATUS_ORDER = ["todo", "in_progress", "in_review", "done"];
  const workflowStatusOptions = createMemo(() => {
    const byKey = Object.fromEntries(
      (statuses() || [])
        .map((s) => ({
          key: String(s?.key || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_"),
          label: String(s?.label || "").trim()
        }))
        .filter((x) => x.key && x.label)
        .map((x) => [x.key, x.label])
    );
    return WORKFLOW_STATUS_ORDER.map((k) => ({
      value: k,
      label: byKey[k] || (k === "todo" ? "Todo" : k === "in_progress" ? "进行中" : k === "in_review" ? "评审中" : "已完成")
    }));
  });

  return (
    <section class="content settings page-wrap team-settings-page surface-card">
      <p class="crumb muted">Teams / {team()?.name ?? ""}</p>
      <h1>{team()?.name ?? "Team settings"}</h1>
      <p class="sub-title muted">管理团队偏好、标签、状态与迭代节奏</p>

      <nav class="team-settings-tabs">
        <For each={TABS}>
          {(t) => (
            <button
              type="button"
              class={tab() === t.id ? "tst-tab tst-tab--active" : "tst-tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </nav>

      <Show when={loading()}>
        <p class="muted">加载中…</p>
      </Show>
      <Show when={!loading()}>
        {error() ? <p class="error-text">{error()}</p> : null}

        <Show when={tab() === "general"}>
          <form class="tst-panel" onSubmit={saveGeneral}>
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">General</h2>
              <Btn variant="save" htmlType="submit" loading={saving()}>
                保存
              </Btn>
            </div>
            <label class="modal-field tst-field">
              <span>团队名称</span>
              <Inp value={name()} onInput={(e) => setName(e.target.value)} aria-label="团队名称" />
            </label>
            <label class="modal-field tst-field">
              <span>Identifier（大写）</span>
              <Inp
                value={identifier()}
                onInput={(e) => setIdentifier(e.target.value.toUpperCase())}
                placeholder="ENG"
                aria-label="Identifier"
              />
            </label>
            <label class="modal-field tst-field">
              <span>主题色</span>
              <Inp type="color" value={accentColor()} onInput={(e) => setAccentColor(e.target.value)} aria-label="主题色" />
            </label>
          </form>
        </Show>

        <Show when={tab() === "members"}>
          <div class="tst-panel">
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">Members</h2>
            </div>
            <p class="muted tst-hint">
              成员以<strong>工作区</strong>为维度管理；以下为当前 Workspace 的成员列表。受邀者加入工作区后，即可与本团队协作（侧栏访问本团队）。
            </p>

            <div class="tst-invite-panel surface-card">
              <h3 class="tst-invite-title">团队邀请链接</h3>
              <p class="muted tst-hint tst-invite-desc">
                生成后<strong> 7 天</strong>内有效；同一链接有效期内可分享给多人重复使用。仅限 Workspace 管理员/所有者操作；加入后为 member。
              </p>
              <div class="tst-invite-actions">
                <Btn variant="create" type="button" loading={inviteBusy()} disabled={inviteBusy()} onClick={() => createWorkspaceInviteLink()}>
                  {inviteBusy() ? "生成中…" : "生成邀请链接"}
                </Btn>
                <Btn variant="default" type="button" disabled={!inviteLink()} onClick={() => copyInviteLink()}>
                  复制链接
                </Btn>
              </div>
              {inviteErr() ? <p class="error-text tst-invite-error">{inviteErr()}</p> : null}
              <Show when={inviteLink()}>
                <div class="tst-invite-link-box">
                  <code class="tst-invite-link-code">{inviteLink()}</code>
                </div>
                <Show when={inviteExpires()}>
                  <p class="muted tst-invite-meta">
                    过期时间：
                    <time dateTime={inviteExpires()}>{new Date(inviteExpires()).toLocaleString("zh-CN")}</time>
                  </p>
                </Show>
              </Show>
              {copyHint() ? <p class="muted tst-copy-hint">{copyHint()}</p> : null}
            </div>

            <table class="tst-members-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色</th>
                  <th>加入时间</th>
                </tr>
              </thead>
              <tbody>
                <For each={members()}>
                  {(m) => (
                    <tr>
                      <td>{m.name}</td>
                      <td>{m.role}</td>
                      <td>{m.joinedAt?.slice?.(0, 10)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={tab() === "labels"}>
          <form class="tst-panel" onSubmit={saveLabels}>
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">Issue labels</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                <Btn variant="create" type="button" onClick={() => setLabels([...labels(), emptyLabel()])}>
                  新增
                </Btn>
                <Btn variant="save" htmlType="submit" loading={saving()}>
                  保存
                </Btn>
              </div>
            </div>
            <Index each={labels()}>
              {(row, index) => (
                <div class="tst-rows">
                  <Inp
                    placeholder="标签名"
                    value={row().name}
                    onInput={(e) => updateLabel(index, "name", e.target.value)}
                  />
                  <Inp
                    type="color"
                    value={row().color || "#64748b"}
                    onInput={(e) => updateLabel(index, "color", e.target.value)}
                  />
                  <Btn
                    variant="text"
                    type="button"
                    class="btn-ordo-danger-text"
                    disabled={labels().length <= 1}
                    onClick={() => setLabels((prev) => prev.filter((_, i) => i !== index))}
                  >
                    移除
                  </Btn>
                </div>
              )}
            </Index>
          </form>
        </Show>

        <Show when={tab() === "statuses"}>
          <form class="tst-panel" onSubmit={saveStatuses}>
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">Issue statuses</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                <Btn variant="create" type="button" onClick={() => setStatuses([...statuses(), emptyStatus()])}>
                  新增
                </Btn>
                <Btn variant="save" htmlType="submit" loading={saving()}>
                  保存
                </Btn>
              </div>
            </div>
            <Index each={statuses()}>
              {(row, index) => (
                <div class="tst-rows tst-rows-status">
                  <Inp
                    placeholder="键（todo / in_progress）"
                    value={row().key}
                    onInput={(e) => updateStatus(index, "key", e.target.value)}
                  />
                  <Inp
                    placeholder="显示名称"
                    value={row().label}
                    onInput={(e) => updateStatus(index, "label", e.target.value)}
                  />
                  <Btn
                    variant="text"
                    type="button"
                    class="btn-ordo-danger-text"
                    disabled={statuses().length <= 1}
                    onClick={() => setStatuses((prev) => prev.filter((_, i) => i !== index))}
                  >
                    移除
                  </Btn>
                </div>
              )}
            </Index>
          </form>
        </Show>

        <Show when={tab() === "cycles"}>
          <form class="tst-panel" onSubmit={saveCycleSettings}>
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">Cycle</h2>
              <Btn variant="save" htmlType="submit" loading={saving()}>
                保存
              </Btn>
            </div>
            <p class="muted tst-hint">
              用于规划迭代节奏；新建 Cycle 时仍可手动指定日期。以下为根据当前配置推算的<strong>最近 3 次</strong>迭代起止日（自然日，本地时区）。
            </p>
            <div class="tst-field" style={{ display: "flex", "align-items": "center", gap: "10px" }}>
              <ToggleSwitch
                checked={autoCreateDailyCycles()}
                onChange={(v) => setAutoCreateDailyCycles(Boolean(v))}
                aria-label="自动创建日常迭代"
              />
              <span>自动创建日常迭代</span>
            </div>
            <p class="muted tst-hint" style={{ "margin-top": "-4px" }}>
              开启后，服务端每日定时任务会按下方节奏为团队<strong>至少提前准备 1 个</strong>未开始的<strong>日常迭代</strong>（与手动创建的项目迭代无关）；关闭后不再自动补齐。
            </p>
            <label class="modal-field tst-field">
              <span>迭代从周几开始</span>
              <Sel
                class="fullw"
                aria-label="迭代开始星期"
                value={startWeekday()}
                onChange={(v) => setStartWeekday(String(v))}
                options={WEEKDAY_OPTIONS_JS.map((o) => ({ value: String(o.value), label: o.label }))}
              />
            </label>
            <label class="modal-field tst-field">
              <span>单次迭代天数</span>
              <Inp
                class="fullw"
                type="number"
                min={1}
                max={365}
                value={iterationDays()}
                onInput={(e) => setIterationDays(e.target.value)}
                aria-label="迭代天数"
              />
            </label>
            <label class="modal-field tst-field">
              <span>冷静期天数（相邻迭代间隙）</span>
              <Inp
                class="fullw"
                type="number"
                min={0}
                max={90}
                value={cooldownDays()}
                onInput={(e) => setCooldownDays(e.target.value)}
                aria-label="冷静期"
              />
            </label>

            <div class="tst-cycle-preview">
              <h3 class="tst-cycle-preview-title">最近三次迭代预览</h3>
              <ul class="tst-cycle-preview-list">
                <For each={cyclePreviewRows()}>
                  {(row, idx) => (
                    <li class="tst-cycle-preview-row">
                      <span class="tst-cycle-preview-idx">第 {idx() + 1} 次</span>
                      <span class="tst-cycle-preview-range">
                        {fmtDay(row.start)} — {fmtDay(row.end)}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </form>
        </Show>

        <Show when={tab() === "workflow"}>
          <form class="tst-panel" onSubmit={saveWorkflow}>
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">Workflow</h2>
              <Btn variant="save" htmlType="submit" loading={saving()}>
                保存
              </Btn>
            </div>
            <p class="muted tst-hint">
              与 Linear 类似：Webhook 把 GitLab 活动写入任务后，在<strong>任务详情 → 开发与合并</strong>中展示 MR/分支/提交链接。此处 Workflow
              为<strong>可选</strong>：在识别到任务编号（来自分支名、MR 标题/描述、commit message 等）时，按下方规则<strong>自动更新任务状态</strong>。
            </p>

            <div class="tst-field" style={{ display: "flex", "align-items": "center", gap: "10px" }}>
              <ToggleSwitch
                checked={Boolean(workflow()?.gitlab?.enabled)}
                onChange={(v) => updateWorkflowGitlab({ enabled: Boolean(v) })}
              />
              <span>启用 GitLab 状态自动化（可选）</span>
            </div>

            <label class="modal-field tst-field">
              <span>Webhook URL</span>
              <Inp value={webhookUrl()} disabled aria-label="Webhook URL" />
            </label>
            <label class="modal-field tst-field">
              <span>Secret Token（GitLab: X-Gitlab-Token）</span>
              <Inp
                value={workflow()?.gitlab?.secret || ""}
                onInput={(e) => updateWorkflowGitlab({ secret: e.target.value })}
                placeholder="建议使用随机字符串"
                aria-label="GitLab Secret Token"
              />
            </label>

            <div class="tst-field">
              <h3 style={{ margin: "10px 0 6px", "font-size": "12px" }}>默认规则</h3>
              <div class="tst-rows" style={{ "grid-template-columns": "1fr 1fr" }}>
                <label class="modal-field">
                  <span>Draft MR 打开/更新</span>
                  <Sel
                    class="fullw"
                    aria-label="onDraftOpen"
                    value={workflow()?.gitlab?.rules?.onDraftOpen || "in_progress"}
                    options={workflowStatusOptions()}
                    onChange={(v) => updateWorkflowRules({ onDraftOpen: v })}
                  />
                </label>
                <label class="modal-field">
                  <span>MR 打开</span>
                  <Sel
                    class="fullw"
                    aria-label="onPrOpen"
                    value={workflow()?.gitlab?.rules?.onPrOpen || "in_progress"}
                    options={workflowStatusOptions()}
                    onChange={(v) => updateWorkflowRules({ onPrOpen: v })}
                  />
                </label>
                <label class="modal-field">
                  <span>MR 活动（更新/评论/Push）</span>
                  <Sel
                    class="fullw"
                    aria-label="onPrActivity"
                    value={workflow()?.gitlab?.rules?.onPrActivity || "in_progress"}
                    options={workflowStatusOptions()}
                    onChange={(v) => updateWorkflowRules({ onPrActivity: v })}
                  />
                </label>
                <label class="modal-field">
                  <span>Ready for merge（approved）</span>
                  <Sel
                    class="fullw"
                    aria-label="onReadyForMerge"
                    value={workflow()?.gitlab?.rules?.onReadyForMerge || "in_review"}
                    options={workflowStatusOptions()}
                    onChange={(v) => updateWorkflowRules({ onReadyForMerge: v })}
                  />
                </label>
                <label class="modal-field">
                  <span>Merge</span>
                  <Sel
                    class="fullw"
                    aria-label="onMerge"
                    value={workflow()?.gitlab?.rules?.onMerge || "done"}
                    options={workflowStatusOptions()}
                    onChange={(v) => updateWorkflowRules({ onMerge: v })}
                  />
                </label>
              </div>
            </div>

            <div class="tst-field">
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "10px", margin: "10px 0 6px" }}>
                <h3 style={{ margin: 0, "font-size": "12px" }}>分支规则（按目标分支覆盖）</h3>
                <Btn
                  variant="create"
                  type="button"
                  onClick={() => updateWorkflowGitlab({ branchRules: [...(workflow()?.gitlab?.branchRules || []), emptyBranchRule()] })}
                >
                  新增分支规则
                </Btn>
              </div>

              <Index each={workflow()?.gitlab?.branchRules || []}>
                {(row, index) => (
                  <div class="tst-invite-panel surface-card" style={{ margin: "8px 0", padding: "12px" }}>
                    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                      <Inp
                        class="fullw"
                        placeholder="目标分支 Regex（例如 ^devreview_.* ）"
                        value={row().targetBranchRegex || ""}
                        onInput={(e) => updateBranchRule(index, { targetBranchRegex: e.target.value })}
                        aria-label="targetBranchRegex"
                      />
                      <Btn
                        variant="text"
                        type="button"
                        class="btn-ordo-danger-text"
                        onClick={() =>
                          updateWorkflowGitlab({
                            branchRules: (workflow()?.gitlab?.branchRules || []).filter((_, i) => i !== index)
                          })
                        }
                      >
                        移除
                      </Btn>
                    </div>

                    <div class="tst-rows" style={{ "grid-template-columns": "1fr 1fr", margin: "10px 0 0" }}>
                      <label class="modal-field">
                        <span>Draft</span>
                        <Sel
                          class="fullw"
                          value={row().rules?.onDraftOpen || ""}
                          options={[{ value: "", label: "跟随默认" }, ...workflowStatusOptions()]}
                          onChange={(v) => updateBranchRuleRules(index, { onDraftOpen: v || null })}
                        />
                      </label>
                      <label class="modal-field">
                        <span>Open</span>
                        <Sel
                          class="fullw"
                          value={row().rules?.onPrOpen || ""}
                          options={[{ value: "", label: "跟随默认" }, ...workflowStatusOptions()]}
                          onChange={(v) => updateBranchRuleRules(index, { onPrOpen: v || null })}
                        />
                      </label>
                      <label class="modal-field">
                        <span>Activity</span>
                        <Sel
                          class="fullw"
                          value={row().rules?.onPrActivity || ""}
                          options={[{ value: "", label: "跟随默认" }, ...workflowStatusOptions()]}
                          onChange={(v) => updateBranchRuleRules(index, { onPrActivity: v || null })}
                        />
                      </label>
                      <label class="modal-field">
                        <span>Ready</span>
                        <Sel
                          class="fullw"
                          value={row().rules?.onReadyForMerge || ""}
                          options={[{ value: "", label: "跟随默认" }, ...workflowStatusOptions()]}
                          onChange={(v) => updateBranchRuleRules(index, { onReadyForMerge: v || null })}
                        />
                      </label>
                      <label class="modal-field">
                        <span>Merge</span>
                        <Sel
                          class="fullw"
                          value={row().rules?.onMerge || ""}
                          options={[{ value: "", label: "跟随默认" }, ...workflowStatusOptions()]}
                          onChange={(v) => updateBranchRuleRules(index, { onMerge: v || null })}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </Index>
            </div>
          </form>
        </Show>

        <Show when={tab() === "notifications"}>
          <form class="tst-panel" onSubmit={saveNotifications}>
            <div class="tst-panel-head">
              <h2 class="tst-panel-title">Notifications</h2>
              <Btn variant="save" htmlType="submit" loading={saving()}>
                保存
              </Btn>
            </div>
            <p class="muted tst-hint">
              目前预置<strong>钉钉群自定义机器人</strong>。你只需要配置机器人 Webhook URL（可选加签 Secret），消息模板内置在代码中。
            </p>

            <div class="tst-field" style={{ display: "flex", "align-items": "center", gap: "10px" }}>
              <ToggleSwitch checked={Boolean(notifications()?.dingtalk?.enabled)} onChange={(v) => updateDingTalk({ enabled: Boolean(v) })} />
              <span>启用钉钉通知</span>
            </div>

            <label class="modal-field tst-field">
              <span>机器人 Webhook URL</span>
              <Inp
                value={notifications()?.dingtalk?.botWebhookUrl || ""}
                onInput={(e) => updateDingTalk({ botWebhookUrl: e.target.value })}
                placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                aria-label="钉钉机器人 Webhook URL"
              />
            </label>
            <label class="modal-field tst-field">
              <span>加签 Secret（可选）</span>
              <Inp
                value={notifications()?.dingtalk?.botSecret || ""}
                onInput={(e) => updateDingTalk({ botSecret: e.target.value })}
                placeholder="开启“加签”时填写"
                aria-label="钉钉机器人 Secret"
              />
            </label>
          </form>
        </Show>
      </Show>
    </section>
  );
}
