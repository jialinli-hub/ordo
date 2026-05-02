import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client";
import { teamSegmentForUrl } from "../../lib/teamSlug";
import {
  Btn,
  Inp,
  Modal,
  Popover,
  Sel,
  TagSpan,
  TextArea,
  ToggleSwitch
} from "../../ui/primitives.jsx";
import { PRIORITY_META, STATUS_META, TYPE_LABEL, issueDisplayRef, typeTagClass } from "./issueUi";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

const STATUS_OPTIONS = [
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "进行中" },
  { value: "in_review", label: "评审中" },
  { value: "done", label: "已完成" }
];

const PRIORITY_OPTIONS = Object.entries(PRIORITY_META).map(([value, label]) => ({
  value: Number(value),
  label
}));

function navigateTo(path) {
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** 子任务列表工时合计展示（只对有限数字累加） */
function formatSubtaskHoursTotal(sum) {
  if (!Number.isFinite(sum)) {
    return "—";
  }
  const n = Number(sum.toFixed(2));
  return String(n);
}

/** 单条任务的预估工时展示 */
function formatEstimateHoursCell(h) {
  if (h == null || h === "") {
    return "—";
  }
  const n = Number(h);
  if (!Number.isFinite(n)) {
    return "—";
  }
  return String(Number(n.toFixed(2)));
}

export function IssueDetail(props) {
  const teamName = () => props.teamName ?? "";
  const teamId = () => props.teamId;
  const routeIssueKey = createMemo(() => {
    const raw = props.issueId || "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  });
  const projects = () => props.projects ?? [];
  const cycles = () => props.cycles ?? [];
  const members = () => props.members ?? [];

  function withWorkspacePrefix(path) {
    return `${props.workspacePathPrefix ?? ""}${path}`;
  }

  const [issue, setIssue] = createSignal(null);
  const [profile, setProfile] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [detailError, setDetailError] = createSignal("");
  const [commentBody, setCommentBody] = createSignal("");
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [labelJoined, setLabelJoined] = createSignal("");
  const [estimateDraft, setEstimateDraft] = createSignal("");
  const [descFontPx, setDescFontPx] = createSignal(13);
  const [cycleEpics, setCycleEpics] = createSignal([]);
  const [subtaskTitle, setSubtaskTitle] = createSignal("");
  const [commentSending, setCommentSending] = createSignal(false);

  const teamPathSeg = () => teamSegmentForUrl({ name: teamName(), id: teamId() });

  async function reload() {
    setLoading(true);
    setDetailError("");
    try {
      const [data, prof] = await Promise.all([
        apiGet(`/api/issues/${encodeURIComponent(routeIssueKey())}`),
        apiGet("/api/profile").catch(() => null)
      ]);
      setIssue(data);
      setProfile(prof);
      setLabelJoined((data.labels || []).join(", "));
      setEstimateDraft(data.estimateHours != null ? String(data.estimateHours) : "");
    } catch (e) {
      setDetailError(e instanceof Error && e.message ? e.message : "加载任务失败");
      setIssue(null);
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    routeIssueKey();
    void reload();
  });

  createEffect(() => {
    const i = issue();
    const cid = i?.cycleId;
    if (!cid) {
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
    return () => {
      alive = false;
    };
  });

  createEffect(() => {
    const i = issue();
    const key = routeIssueKey();
    if (loading() || !i || !i.issues_id || key !== i.id) {
      return;
    }
    const path = withWorkspacePrefix(
      `/workspace/teams/${teamPathSeg()}/issues/${encodeURIComponent(i.issues_id)}`
    );
    if (window.location.pathname !== path) {
      navigateTo(path);
    }
  });

  const projectMap = createMemo(() => Object.fromEntries(projects().map((p) => [p.id, p])));

  const project = () => {
    const i = issue();
    return i ? projectMap()[i.projectId] : null;
  };

  const idStr = () => {
    const i = issue();
    return i ? issueDisplayRef(i, project()) : routeIssueKey();
  };

  const subtasksHeadSummary = createMemo(() => {
    const list = issue()?.subtasks ?? [];
    let sum = 0;
    for (const st of list) {
      const h = st?.estimateHours;
      if (h != null && Number.isFinite(Number(h))) {
        sum += Number(h);
      }
    }
    return { count: list.length, hoursSum: sum };
  });

  function memberName(userId) {
    if (!userId) {
      return "未指派";
    }
    const prof = profile();
    if (prof?.id === userId && prof?.name) {
      return prof.name;
    }
    const m = members().find((x) => x.userId === userId);
    return m?.name || "成员";
  }

  function activitySentence(row) {
    const who = memberName(row.userId);
    const t = dayjs(row.createdAt).fromNow();
    if (row.type === "issue_created") {
      return `${who} 创建了任务 · ${t}`;
    }
    if (row.type === "comment_created") {
      return `${who} 发表了评论 · ${t}`;
    }
    if (row.type === "issue_updated") {
      return `${who} 更新了任务 · ${t}`;
    }
    return `${who} · ${t}`;
  }

  async function patchIssue(partial) {
    try {
      const updated = await apiPatch(`/api/issues/${encodeURIComponent(routeIssueKey())}`, partial);
      setIssue((prev) => ({ ...prev, ...updated }));
      props.onIssueUpdated?.(updated);
    } catch {
      setDetailError("保存失败");
    }
  }

  async function submitComment() {
    const body = commentBody().trim();
    if (!body) {
      return;
    }
    setCommentSending(true);
    setDetailError("");
    try {
      await apiPost(`/api/issues/${encodeURIComponent(routeIssueKey())}/comments`, { body });
      setCommentBody("");
      await reload();
    } catch {
      setDetailError("发送评论失败");
    } finally {
      setCommentSending(false);
    }
  }

  function issueDetailHref(refSegment) {
    return withWorkspacePrefix(
      `/workspace/teams/${teamPathSeg()}/issues/${encodeURIComponent(refSegment)}`
    );
  }

  async function addSubtask() {
    const t = subtaskTitle().trim();
    const parentRow = issue();
    if (!t || !parentRow?.id) {
      return;
    }
    setDetailError("");
    try {
      await apiPost("/api/issues", { parentIssueId: parentRow.id, title: t });
      setSubtaskTitle("");
      await reload();
    } catch {
      setDetailError("创建子任务失败");
    }
  }

  async function patchSubtask(subId, partial) {
    setDetailError("");
    try {
      const updated = await apiPatch(`/api/issues/${encodeURIComponent(subId)}`, partial);
      setIssue((prev) => {
        if (!prev?.subtasks?.length) {
          return prev;
        }
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
        };
      });
      props.onIssueUpdated?.(updated);
    } catch {
      setDetailError("更新子任务失败");
    }
  }

  async function confirmDelete() {
    try {
      await apiDelete(`/api/issues/${encodeURIComponent(routeIssueKey())}`);
      setDeleteOpen(false);
      props.onIssueDeleted?.();
      navigateTo(withWorkspacePrefix(`/workspace/teams/${teamPathSeg()}/issues`));
    } catch {
      setDetailError("删除失败");
    }
  }

  function saveLabelsFromDraft() {
    const labels = labelJoined()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    patchIssue({ labels });
  }

  return (
    <>
      <Show when={loading()}>
        <p class="muted issue-detail-loading">加载中…</p>
      </Show>
      <Show when={!loading()}>
        <Show when={detailError() && !issue()}>
          <p class="error-text">{detailError()}</p>
        </Show>
        <Show when={!detailError() && !issue()}>
          <p class="muted">未找到任务。</p>
        </Show>
        <Show when={issue()}>
        {(issueAcc) => {
          const activity = createMemo(() =>
            [...(issueAcc()?.activity || [])].sort(
              (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
            )
          );

          return (
            <div class="issue-detail-shell">
              <header class="issue-detail-topbar">
                <div class="issue-detail-bc">
                  <Btn
                    variant="text"
                    aria-label="返回列表"
                    onClick={() => navigateTo(withWorkspacePrefix(`/workspace/teams/${teamPathSeg()}/issues`))}
                  >
                    ← 返回
                  </Btn>
                  <span class="issue-detail-bc-sep">/</span>
                  <span class="issue-detail-bc-team">{teamName() || "Team"}</span>
                  <span class="issue-detail-bc-sep">›</span>
                  <span class="issue-detail-bc-id muted">{idStr()}</span>
                </div>
                <div class="issue-detail-top-actions">
                  <Btn variant="text" class="btn-ordo-danger-text" onClick={() => setDeleteOpen(true)}>
                    删除
                  </Btn>
                </div>
              </header>

              <Show when={issueAcc()?.parent}>
                <div class="issue-detail-parent-bar muted">
                  <span class="issue-detail-parent-label">父任务</span>
                  <Btn
                    variant="link"
                    type="button"
                    class="issue-detail-parent-link"
                    onClick={() => {
                      const p = issueAcc()?.parent;
                      if (p)
                        navigateTo(issueDetailHref(p.issues_id || p.id));
                    }}
                  >
                    {(() => {
                      const p = issueAcc()?.parent;
                      return (p?.issues_id ? `${p.issues_id} · ` : "") + (p?.title ?? "");
                    })()}
                  </Btn>
                </div>
              </Show>

              {detailError() ? <p class="error-text issue-detail-soft-error">{detailError()}</p> : null}

              <div class="issue-detail-layout">
                <main class="issue-detail-main">
                  <Inp
                    class="issue-detail-title-input"
                    variant="borderless"
                    aria-label="标题"
                    placeholder="标题"
                    value={issueAcc()?.title}
                    onInput={(e) => setIssue((prev) => ({ ...prev, title: e.target.value }))}
                    onBlur={() => patchIssue({ title: issue().title })}
                  />

                  <div class="issue-desc-block">
                    <div class="issue-desc-head">
                      <span class="muted issue-desc-label">描述</span>
                      <div class="issue-desc-zoom">
                        <Btn variant="text" type="button" aria-label="放大编辑区字体" onClick={() => setDescFontPx((x) => Math.min(22, x + 2))}>
                          A+
                        </Btn>
                        <Btn variant="text" type="button" aria-label="缩小编辑区字体" onClick={() => setDescFontPx((x) => Math.max(10, x - 2))}>
                          A−
                        </Btn>
                      </div>
                    </div>
                    <TextArea
                      class="issue-detail-description"
                      variant="borderless"
                      aria-label="描述"
                      placeholder="在此输入描述（支持 Markdown），失焦自动保存"
                      rows={8}
                      style={{ "font-size": `${descFontPx()}px`, "line-height": 1.45 }}
                      value={issueAcc()?.description || ""}
                      onInput={(e) => setIssue((prev) => ({ ...prev, description: e.target.value }))}
                      onBlur={() => patchIssue({ description: issue().description?.trim() || null })}
                    />
                  </div>

                  <section class="issue-detail-subtasks">
                    <div class="issue-detail-section-head">
                      <h3 class="issue-detail-section-title">子任务</h3>
                      <Show when={subtasksHeadSummary().count > 0}>
                        <span
                          class="issue-subtasks-summary muted"
                          aria-label={`${subtasksHeadSummary().count} 条子任务，工时合计 ${formatSubtaskHoursTotal(subtasksHeadSummary().hoursSum)} 小时`}
                        >
                          <span class="issue-subtasks-summary-count">共 {subtasksHeadSummary().count} 条</span>
                          <span class="issue-subtasks-summary-sep" aria-hidden>
                            ·
                          </span>
                          <span class="issue-subtasks-summary-hours">
                            工时合计 {formatSubtaskHoursTotal(subtasksHeadSummary().hoursSum)} h
                          </span>
                        </span>
                      </Show>
                    </div>
                    <Show when={!issueAcc()?.parentIssueId}>
                      <div class="issue-subtasks-add">
                        <Inp
                          class="issue-subtasks-add-input"
                          placeholder="新建子任务标题，回车添加"
                          aria-label="新建子任务标题"
                          value={subtaskTitle()}
                          onInput={(e) => setSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void addSubtask();
                            }
                          }}
                        />
                        <Btn type="button" variant="default" onClick={() => void addSubtask()}>
                          添加
                        </Btn>
                      </div>
                    </Show>
                    <ul class="issue-subtasks-list">
                      <For each={issueAcc()?.subtasks ?? []}>
                        {(st) => (
                          <li class="issue-subtask-row">
                            <span
                              class="issue-status-dot-large"
                              style={{ background: STATUS_META[st.status]?.dot || "#94a3b8" }}
                              title={STATUS_META[st.status]?.label}
                              aria-hidden
                            />
                            <button
                              type="button"
                              class="issue-subtask-main"
                              onClick={() =>
                                navigateTo(issueDetailHref(st.issues_id || st.id))
                              }
                            >
                              <span class="muted issue-subtask-ref">{issueDisplayRef(st, project())}</span>
                              <span class="issue-subtask-title">{st.title}</span>
                            </button>
                            <span
                              class="issue-subtask-hours muted"
                              title="预估工时"
                              aria-label={`预估工时 ${formatEstimateHoursCell(st.estimateHours)} 小时`}
                            >
                              {formatEstimateHoursCell(st.estimateHours)} h
                            </span>
                            <span
                              class="issue-subtask-assignee muted"
                              title={memberName(st.assigneeId)}
                              aria-label={`负责人 ${memberName(st.assigneeId)}`}
                            >
                              {memberName(st.assigneeId)}
                            </span>
                            <Sel
                              class="issue-subtask-status-sel"
                              aria-label={`子任务状态 ${st.title}`}
                              value={st.status}
                              options={STATUS_OPTIONS}
                              onChange={(v) => void patchSubtask(st.id, { status: v })}
                            />
                          </li>
                        )}
                      </For>
                    </ul>
                    <Show when={(issueAcc()?.subtasks ?? []).length === 0}>
                      <p class="muted issue-subtasks-empty">暂无子任务</p>
                    </Show>
                  </section>

                  <section class="issue-detail-activity">
                    <div class="issue-detail-section-head">
                      <h3 class="issue-detail-section-title">动态</h3>
                      <div class="issue-detail-subscribe">
                        <ToggleSwitch checked={false} disabled aria-label="订阅" />
                        <span class="muted">订阅</span>
                      </div>
                    </div>
                    <ul class="issue-activity-list">
                      <For each={activity()}>
                        {(row) => (
                          <li class="issue-activity-row">
                            <span class="issue-assignee-circle sm" aria-hidden>
                              {memberName(row.userId).slice(0, 1)}
                            </span>
                            <span class="issue-activity-text">{activitySentence(row)}</span>
                          </li>
                        )}
                      </For>
                      {activity().length === 0 ? <li class="muted">暂无动态</li> : null}
                    </ul>
                  </section>

                  <section class="issue-detail-comments">
                    <h3 class="issue-detail-section-title">评论</h3>
                    <div class="issue-comment-compose">
                      <TextArea
                        placeholder="留下评论…（Ctrl+Enter 发送）"
                        rows={3}
                        aria-label="评论内容"
                        value={commentBody()}
                        onInput={(e) => setCommentBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            void submitComment();
                          }
                        }}
                      />
                      <div class="issue-comment-compose-actions">
                        <Btn variant="text" disabled aria-label="附件">
                          附件
                        </Btn>
                        <Btn
                          variant="primary"
                          loading={commentSending()}
                          disabled={!commentBody().trim()}
                          onClick={() => void submitComment()}
                        >
                          发送
                        </Btn>
                      </div>
                    </div>
                    <ul class="issue-comment-list">
                      <For each={issueAcc()?.comments || []}>
                        {(c) => (
                          <li class="issue-comment-item">
                            <span class="issue-assignee-circle" aria-hidden>
                              {memberName(c.userId).slice(0, 1)}
                            </span>
                            <div>
                              <div class="issue-comment-meta">
                                <strong>{memberName(c.userId)}</strong>
                                <span class="muted">{dayjs(c.createdAt).fromNow()}</span>
                              </div>
                              <p class="issue-comment-body">{c.body}</p>
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </main>

                <aside class="issue-detail-sidebar">
                  <div class="issue-sidebar-section">
                    <h4 class="issue-sidebar-heading">属性</h4>
                    <div class="issue-prop-row">
                      <span
                        class="issue-status-dot-large"
                        style={{ background: STATUS_META[issueAcc()?.status]?.dot || "#94a3b8" }}
                        title="状态"
                      />
                      <Sel
                        class="issue-prop-select"
                        aria-label="状态"
                        value={issueAcc()?.status}
                        options={STATUS_OPTIONS}
                        onChange={(v) => patchIssue({ status: v })}
                      />
                    </div>
                    <div class="issue-prop-row">
                      <span class="issue-prop-kicker" aria-hidden>
                        P
                      </span>
                      <Sel
                        class="issue-prop-select"
                        aria-label="优先级"
                        value={issueAcc()?.priority}
                        options={PRIORITY_OPTIONS}
                        onChange={(raw) => patchIssue({ priority: Number(raw) })}
                      />
                    </div>
                    <div class="issue-prop-row">
                      <span class="issue-prop-kicker" aria-hidden>
                        @
                      </span>
                      <Sel
                        class="issue-prop-select"
                        aria-label="负责人"
                        value={issueAcc()?.assigneeId || ""}
                        options={[
                          { value: "", label: "未指派" },
                          ...members().map((m) => ({ value: m.userId, label: m.name }))
                        ]}
                        onChange={(v) => patchIssue({ assigneeId: v || null })}
                      />
                    </div>
                    <Popover
                      placement="bottomLeft"
                      content={
                        <Inp
                          type="number"
                          min={0}
                          step={0.5}
                          style={{ width: "160px" }}
                          placeholder="工时（小时）"
                          value={estimateDraft()}
                          onInput={(e) => setEstimateDraft(e.target.value)}
                          onBlur={() => {
                            const raw = estimateDraft().trim();
                            const n = Number(raw);
                            patchIssue({
                              estimateHours: raw === "" || !Number.isFinite(n) ? null : n
                            });
                          }}
                        />
                      }
                    >
                      <button type="button" class="issue-prop-row-btn">
                        <span class="issue-prop-kicker issue-prop-kicker--mono" aria-hidden>
                          h
                        </span>
                        <span>{issueAcc()?.estimateHours != null ? `${issueAcc().estimateHours} h` : "预估工时"}</span>
                      </button>
                    </Popover>
                    <div class="issue-prop-row">
                      <span class="issue-prop-kicker" aria-hidden>
                        ↻
                      </span>
                      <Sel
                        class="issue-prop-select"
                        aria-label="迭代"
                        value={issueAcc()?.cycleId || ""}
                        options={[
                          { value: "", label: "不关联" },
                          ...cycles().map((c) => ({ value: c.id, label: c.name }))
                        ]}
                        onChange={(v) => patchIssue({ cycleId: v || null, cycleEpicId: null })}
                      />
                    </div>
                    <div class="issue-prop-row">
                      <span class="issue-prop-kicker" aria-hidden>
                        ◇
                      </span>
                      <Sel
                        class="issue-prop-select"
                        aria-label="大需求"
                        value={issueAcc()?.cycleEpicId || ""}
                        disabled={!issueAcc()?.cycleId}
                        options={[
                          { value: "", label: issueAcc()?.cycleId ? "不关联大需求" : "请先关联迭代" },
                          ...cycleEpics().map((e) => ({ value: e.id, label: e.name }))
                        ]}
                        onChange={(v) => patchIssue({ cycleEpicId: v || null })}
                      />
                    </div>
                  </div>

                  <div class="issue-sidebar-section">
                    <h4 class="issue-sidebar-heading">标签</h4>
                    <div class="issue-tags-row">
                      <For each={issueAcc()?.labels || []}>{(lb) => <TagSpan class="issue-label-chip">{lb}</TagSpan>}</For>
                      <Popover
                        placement="bottom"
                        content={
                          <Inp
                            placeholder="逗号分隔，回车保存"
                            style={{ width: "220px" }}
                            value={labelJoined()}
                            onInput={(e) => setLabelJoined(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                saveLabelsFromDraft();
                              }
                            }}
                          />
                        }
                      >
                        <Btn variant="link">
                          + 标签
                        </Btn>
                      </Popover>
                    </div>
                  </div>

                  <div class="issue-sidebar-section">
                    <h4 class="issue-sidebar-heading">项目</h4>
                    <Sel
                      class="issue-project-select"
                      aria-label="项目"
                      value={issueAcc()?.projectId}
                      options={projects().map((p) => ({ value: p.id, label: p.name }))}
                      onChange={(v) => patchIssue({ projectId: v })}
                    />
                  </div>

                  <div class="issue-sidebar-meta muted issue-sidebar-small">
                    类型：
                    <TagSpan class={typeTagClass(issueAcc()?.type)}>{TYPE_LABEL[issueAcc()?.type] || issueAcc()?.type}</TagSpan>
                  </div>
                </aside>
              </div>

              <Modal
                title="删除任务"
                open={deleteOpen()}
                onClose={() => setDeleteOpen(false)}
                footer={
                  <>
                    <Btn variant="default" onClick={() => setDeleteOpen(false)}>
                      取消
                    </Btn>
                    <Btn variant="primary" class="btn-ordo-primary" onClick={() => confirmDelete()}>
                      删除
                    </Btn>
                  </>
                }
              >
                <p>
                  确定删除「
                  {issueAcc()?.title}
                  」？此操作不可恢复。
                </p>
              </Modal>
            </div>
          );
        }}
        </Show>
      </Show>
    </>
  );
}
