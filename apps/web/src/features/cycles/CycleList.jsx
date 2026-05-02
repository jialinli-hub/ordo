import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { Btn, Inp, Modal, TagSpan } from "../../ui/primitives.jsx";
import { apiGet, apiPost } from "../../api/client";
import { GROUP_ORDER, STATUS_META, TYPE_LABEL } from "../issues/issueUi";

function formatCycleRange(startsAt, endsAt) {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const o = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("zh-CN", o)} – ${e.toLocaleDateString("zh-CN", o)}`;
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

/** 当前进行中的迭代：取已开始时间最晚的一条（避免重叠窗口歧义） */
function pickCurrentCycle(raw, now = new Date()) {
  const actives = raw.filter((item) => computeCycleStatus(item.startsAt, item.endsAt, now) === "active");
  if (actives.length === 0) {
    return [];
  }
  actives.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  return [actives[0]];
}

/** 下个迭代：未开始且开始时间最早的一条 */
function pickNextUpcomingCycle(raw, now = new Date()) {
  const planned = raw.filter((item) => computeCycleStatus(item.startsAt, item.endsAt, now) === "planned");
  if (planned.length === 0) {
    return [];
  }
  planned.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return [planned[0]];
}

const TYPE_KEYS = ["feature", "bug", "chore"];

const TYPE_LABEL_ZH = {
  feature: "功能",
  bug: TYPE_LABEL.bug,
  chore: "事务"
};

function statusCountFromSummary(summary, key) {
  if (summary?.byStatus && typeof summary.byStatus[key] === "number") {
    return summary.byStatus[key];
  }
  const legacy = {
    todo: summary?.todoIssues,
    in_progress: summary?.inProgressIssues,
    in_review: summary?.inReviewIssues,
    done: summary?.doneIssues
  };
  return Number(legacy[key] ?? 0);
}

function typeCountFromSummary(summary, key) {
  return Number(summary?.byType?.[key] ?? 0);
}

/** 单行迭代任务完成进度（用于进度条与文案，非列表汇总） */
function rowIssueProgress(item) {
  const s = item.summary || {};
  const total = Number(s.totalIssues || 0);
  const done = Number(s.doneIssues || 0);
  const pct =
    total > 0 ? Math.round((done / total) * 100) : Math.round(Number(s.completionRate || 0));
  return { done, total, pct };
}

export function CycleList(props) {
  const cycleView = () => props.cycleView ?? "all";
  const title = () => props.title ?? "Cycles";
  const teamId = () => props.teamId ?? "";

  const [items, setItems] = createSignal([]);
  const [name, setName] = createSignal("");
  const [startsAt, setStartsAt] = createSignal("");
  const [endsAt, setEndsAt] = createSignal("");
  const [error, setError] = createSignal("");
  const [createOpen, setCreateOpen] = createSignal(false);
  const [epicDraft, setEpicDraft] = createSignal({});

  let refreshSeq = 0;

  /** all：全部迭代（开始时间新→旧）；current / upcoming：各只展示一条 */
  const displayed = createMemo(() => {
    const raw = items();
    if (cycleView() === "current") {
      return pickCurrentCycle(raw);
    }
    if (cycleView() === "upcoming") {
      return pickNextUpcomingCycle(raw);
    }
    return [...raw].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  });

  async function refreshList() {
    const seq = ++refreshSeq;
    const id = teamId();
    const query = id ? `?teamId=${encodeURIComponent(id)}` : "";
    const data = await apiGet(`/api/cycles${query}`);
    if (seq !== refreshSeq) {
      return;
    }
    const batch = Array.isArray(data.items) ? data.items : [];
    setItems([...batch]);
  }

  onMount(() => {
    refreshList().catch(() => {
      setError("Cycle 加载失败");
    });
  });

  async function handleCreateCycle(event) {
    event?.preventDefault?.();
    if (!name() || !startsAt() || !endsAt()) {
      setError("请填写完整的 Cycle 信息");
      return;
    }
    setError("");
    try {
      await apiPost("/api/cycles", {
        teamId: teamId(),
        name: name(),
        startsAt: new Date(startsAt()).toISOString(),
        endsAt: new Date(endsAt()).toISOString()
      });
      setName("");
      setStartsAt("");
      setEndsAt("");
      setCreateOpen(false);
      await refreshList();
    } catch {
      setError("创建 Cycle 失败");
    }
  }

  async function handleAddEpic(cycleId) {
    const key = cycleId;
    const raw = (epicDraft()[key] ?? "").trim();
    if (!raw) {
      return;
    }
    setError("");
    try {
      await apiPost(`/api/cycles/${encodeURIComponent(cycleId)}/epics`, { name: raw });
      setEpicDraft((prev) => ({ ...prev, [key]: "" }));
      await refreshList();
    } catch {
      setError("添加大需求失败");
    }
  }

  function statusLabel(status) {
    if (status === "active") {
      return "当前";
    }
    if (status === "planned") {
      return "未开始";
    }
    return "已结束";
  }

  function statusTagColor(status) {
    if (status === "active") {
      return "processing";
    }
    if (status === "planned") {
      return "default";
    }
    return "success";
  }

  return (
    <section class="cycle-panel surface-card">
      <div class="cycle-header-row">
        <h2 class="panel-title cycle-page-title">{title()}</h2>
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>
          创建 Cycle
        </Btn>
      </div>
      {error() ? <p class="error-text">{error()}</p> : null}

      <ul class="cycle-list">
        {displayed().map((item) => (
          <li class="cycle-row-card" data-key={item.id}>
            {/* 单行三栏：与其它内容隔离，避免与下方明细同属 grid 时错位 */}
            <div class="cycle-row-primary">
              <div class="cycle-row-col cycle-row-col--name">
                <div class="cycle-row-nameblock">
                  <strong class="cycle-row-name">{item.name}</strong>
                  <TagSpan color={statusTagColor(computeCycleStatus(item.startsAt, item.endsAt))}>
                    {statusLabel(computeCycleStatus(item.startsAt, item.endsAt))}
                  </TagSpan>
                </div>
              </div>
              <div class="cycle-row-col cycle-row-col--stats">
                <div class="cycle-row-dates muted">{formatCycleRange(item.startsAt, item.endsAt)}</div>
                <div class="cycle-row-progress-stack">
                  <div class="cycle-row-progress-track">
                    <div
                      class="cycle-row-progress-fill"
                      style={{ width: `${rowIssueProgress(item).pct}%` }}
                    />
                  </div>
                  <div class="cycle-row-progress-feet muted">
                    <span class="cycle-row-progress-meta">
                      {(() => {
                        const { done, total, pct } = rowIssueProgress(item);
                        return total > 0 ? `${done}/${total} · ${pct}%` : `— / — · ${pct}%`;
                      })()}
                    </span>
                    <div class="cycle-row-metrics-inline">
                      <span>任务 {item.summary?.totalIssues ?? 0}</span>
                      <span class="cycle-row-metrics-sep">·</span>
                      <span>已完成 {item.summary?.doneIssues ?? 0}</span>
                      <span class="cycle-row-metrics-sep">·</span>
                      <span>完成率 {Math.round(Number(item.summary?.completionRate || 0))}%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cycle-row-col cycle-row-col--epics">
                <div class="cycle-epics-block cycle-epics-block--rail">
                  <span class="cycle-epics-label">大需求</span>
                  <div class="cycle-epics-chips">
                    <For each={item.epics ?? []}>
                      {(ep) => <span class="cycle-epic-chip">{ep.name}</span>}
                    </For>
                    <Show when={!item.epics?.length}>
                      <span class="muted cycle-epics-empty">暂无</span>
                    </Show>
                  </div>
                  <div class="cycle-epic-add">
                    <Inp
                      aria-label={`大需求名称 ${item.name}`}
                      class="cycle-epic-add-input"
                      placeholder="输入大需求名称"
                      value={epicDraft()[item.id] ?? ""}
                      onInput={(e) =>
                        setEpicDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddEpic(item.id);
                        }
                      }}
                    />
                    <Btn type="button" variant="default" onClick={() => handleAddEpic(item.id)}>
                      添加
                    </Btn>
                  </div>
                </div>
              </div>
            </div>
            <Show when={cycleView() === "current"}>
              <div class="cycle-current-analytics" aria-label="当前迭代详细统计">
                <div class="cycle-analytics-row2">
                  <div class="cycle-analytics-block">
                    <h4 class="cycle-analytics-block-title">按状态</h4>
                    <ul class="cycle-analytics-list">
                      <For each={GROUP_ORDER}>
                        {(st) => {
                          const n = statusCountFromSummary(item.summary, st);
                          const total = Number(item.summary?.totalIssues || 0);
                          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                          return (
                            <li class="cycle-analytics-metric-row">
                              <span class="cycle-analytics-metric-label">{STATUS_META[st]?.label ?? st}</span>
                              <span class="cycle-analytics-metric-num">{n}</span>
                              <div class="cycle-analytics-metric-track">
                                <div
                                  class="cycle-analytics-metric-fill"
                                  style={{
                                    width: `${pct}%`,
                                    background: STATUS_META[st]?.dot || "#94a3b8"
                                  }}
                                />
                              </div>
                              <span class="cycle-analytics-metric-pct muted">{pct}%</span>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </div>
                  <div class="cycle-analytics-block">
                    <h4 class="cycle-analytics-block-title">按类别</h4>
                    <ul class="cycle-analytics-list">
                      <For each={TYPE_KEYS}>
                        {(tp) => {
                          const n = typeCountFromSummary(item.summary, tp);
                          const total = Number(item.summary?.totalIssues || 0);
                          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                          return (
                            <li class="cycle-analytics-metric-row">
                              <span class="cycle-analytics-metric-label">{TYPE_LABEL_ZH[tp] ?? TYPE_LABEL[tp]}</span>
                              <span class="cycle-analytics-metric-num">{n}</span>
                              <div class="cycle-analytics-metric-track">
                                <div class="cycle-analytics-metric-fill cycle-analytics-metric-fill--type" style={{ width: `${pct}%` }} />
                              </div>
                              <span class="cycle-analytics-metric-pct muted">{pct}%</span>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </div>
                  <div class="cycle-analytics-block">
                    <h4 class="cycle-analytics-block-title">工时</h4>
                    <dl class="cycle-analytics-dl">
                      <div class="cycle-analytics-dl-row">
                        <dt>已登记总工时</dt>
                        <dd>{Number(item.summary?.estimateHoursTotal ?? 0)} h</dd>
                      </div>
                      <div class="cycle-analytics-dl-row">
                        <dt>已完成任务工时</dt>
                        <dd>{Number(item.summary?.estimateHoursDone ?? 0)} h</dd>
                      </div>
                      <div class="cycle-analytics-dl-row">
                        <dt>剩余工时（未完成任务）</dt>
                        <dd>{Number(item.summary?.estimateHoursRemaining ?? 0)} h</dd>
                      </div>
                      <div class="cycle-analytics-dl-row">
                        <dt>未填估算任务数</dt>
                        <dd>{Number(item.summary?.estimateUnset ?? 0)}</dd>
                      </div>
                      <div class="cycle-analytics-dl-row">
                        <dt>范围任务数</dt>
                        <dd>{Number(item.summary?.scopeCount ?? item.summary?.totalIssues ?? 0)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </Show>
          </li>
        ))}
      </ul>

      <Modal
        open={createOpen()}
        title="创建 Cycle"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Btn variant="default" onClick={() => setCreateOpen(false)}>
              取消
            </Btn>
            <Btn variant="primary" onClick={(e) => handleCreateCycle(e)}>
              创建
            </Btn>
          </>
        }
      >
        <form class="cycle-form" onSubmit={handleCreateCycle}>
          <Inp
            aria-label="Cycle name"
            placeholder="Cycle 名称"
            value={name()}
            onInput={(event) => setName(event.target.value)}
          />
          <Inp
            aria-label="Cycle startsAt"
            type="date"
            value={startsAt()}
            onInput={(event) => setStartsAt(event.target.value)}
          />
          <Inp
            aria-label="Cycle endsAt"
            type="date"
            value={endsAt()}
            onInput={(event) => setEndsAt(event.target.value)}
          />
        </form>
      </Modal>
    </section>
  );
}
