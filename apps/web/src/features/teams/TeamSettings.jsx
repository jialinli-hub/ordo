import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import { apiGet, apiPatch, apiPost } from "../../api/client";
import { WEEKDAY_OPTIONS_JS, previewTeamIterations } from "../../lib/teamCyclePreview";
import { Btn, Inp, Sel } from "../../ui/primitives.jsx";

const TABS = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "labels", label: "Issue labels" },
  { id: "statuses", label: "Issue statuses" },
  { id: "cycles", label: "Cycle" }
];

function emptyLabel() {
  return { name: "", color: "#64748b" };
}

function emptyStatus() {
  return { key: "", label: "" };
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
  const [inviteBusy, setInviteBusy] = createSignal(false);
  const [inviteLink, setInviteLink] = createSignal("");
  const [inviteExpires, setInviteExpires] = createSignal("");
  const [inviteErr, setInviteErr] = createSignal("");
  const [copyHint, setCopyHint] = createSignal("");
  const [labels, setLabels] = createSignal([emptyLabel()]);
  const [statuses, setStatuses] = createSignal([emptyStatus()]);
  const [members, setMembers] = createSignal([]);

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
      const lbs = Array.isArray(full.issueLabels) && full.issueLabels.length ? full.issueLabels : [{ name: "", color: "#94a3b8" }];
      setLabels(lbs);
      const sts = Array.isArray(full.issueStatuses) && full.issueStatuses.length ? full.issueStatuses : [{ key: "", label: "" }];
      setStatuses(sts);
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
        iterationStartWeekday: Number.isFinite(dow) ? Math.min(6, Math.max(0, Math.round(dow))) : 1
      },
      "Cycle 设置已保存"
    );
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
      const data = await apiPost(`/api/workspaces/${encodeURIComponent(wid)}/invites`, { role: "member" });
      const base = data.inviteLink || "";
      const tid = team()?.id;
      const sep = base.includes("?") ? "&" : "?";
      const link = base && tid ? `${base}${sep}team=${encodeURIComponent(tid)}` : base;
      setInviteLink(link);
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

  return (
    <section class="content settings page-wrap team-settings-page surface-card flat-top">
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
              <Btn variant="primary" htmlType="submit" loading={saving()}>
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
                <Btn variant="primary" type="button" loading={inviteBusy()} disabled={inviteBusy()} onClick={() => createWorkspaceInviteLink()}>
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
                <Btn variant="default" type="button" onClick={() => setLabels([...labels(), emptyLabel()])}>
                  新增
                </Btn>
                <Btn variant="primary" htmlType="submit" loading={saving()}>
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
                <Btn variant="default" type="button" onClick={() => setStatuses([...statuses(), emptyStatus()])}>
                  新增
                </Btn>
                <Btn variant="primary" htmlType="submit" loading={saving()}>
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
              <Btn variant="primary" htmlType="submit" loading={saving()}>
                保存
              </Btn>
            </div>
            <p class="muted tst-hint">
              用于规划迭代节奏；新建 Cycle 时仍可手动指定日期。以下为根据当前配置推算的<strong>最近 3 次</strong>迭代起止日（自然日，本地时区）。
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
      </Show>
    </section>
  );
}
