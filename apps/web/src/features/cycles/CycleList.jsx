import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Btn, Inp, Modal, TagSpan } from "../../ui/primitives.jsx";
import { apiGet, apiPost } from "../../api/client";
import { PRIORITY_META, STATUS_META, TYPE_LABEL } from "../issues/issueUi";

function metricMax(obj) {
  if (!obj || typeof obj !== "object") {
    return 1;
  }
  const vals = Object.values(obj).map((n) => Number(n) || 0);
  const m = Math.max(0, ...vals);
  return m > 0 ? m : 1;
}

function CycleBarRow(pp) {
  const max = () => pp.max || 1;
  const n = () => Number(pp.value || 0);
  const pct = () => Math.round((n() / max()) * 100);
  return (
    <div class="cycle-metric-bar-row">
      <span class="cycle-metric-bar-label">{pp.label}</span>
      <div class="cycle-metric-bar-track">
        <div class="cycle-metric-bar-fill" style={{ width: `${pct()}%`, background: pp.color || "var(--accent, #c8a97e)" }} />
      </div>
      <span class="cycle-metric-bar-num">{n()}</span>
    </div>
  );
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
  const [metrics, setMetrics] = createSignal(null);

  /** 忽略过期的 GET 结果，避免 onMount 与创建后刷新的并发请求乱序覆盖列表 */
  let refreshSeq = 0;

  const displayed = createMemo(() => {
    if (cycleView() === "current") {
      return items().filter((item) => computeCycleStatus(item.startsAt, item.endsAt) === "active");
    }
    if (cycleView() === "upcoming") {
      return items().filter((item) => computeCycleStatus(item.startsAt, item.endsAt) === "planned");
    }
    return items();
  });

  const aggregateSummary = createMemo(() => {
    return displayed().reduce(
      (acc, item) => {
        const summary = item.summary || {};
        acc.totalIssues += Number(summary.totalIssues || 0);
        acc.inProgressIssues += Number(summary.inProgressIssues || 0);
        acc.doneIssues += Number(summary.doneIssues || 0);
        return acc;
      },
      { totalIssues: 0, inProgressIssues: 0, doneIssues: 0 }
    );
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
    // 新数组引用，避免与上一轮同一引用时 Solid 跳过更新（含内存 store / 原位 push 的场景）
    setItems([...batch]);
  }

  onMount(() => {
    refreshList().catch(() => {
      setError("Cycle 加载失败");
    });
  });

  createEffect(() => {
    const id = teamId();
    if (!id) {
      setMetrics(null);
      return;
    }
    let alive = true;
    apiGet(`/api/cycles/team-metrics?teamId=${encodeURIComponent(id)}`)
      .then((data) => {
        if (alive) {
          setMetrics(data);
        }
      })
      .catch(() => {
        /* 图表为增强能力，失败静默 */
      });
    onCleanup(() => {
      alive = false;
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

  function statusLabel(status) {
    if (status === "active") {
      return "Current";
    }
    if (status === "planned") {
      return "Upcoming";
    }
    return "Completed";
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

  const statusBars = createMemo(() => {
    const m = metrics()?.issueTotals?.byStatus;
    if (!m) {
      return [];
    }
    const max = metricMax(m);
    return Object.entries(m).map(([k, v]) => ({
      label: STATUS_META[k]?.label ?? k,
      value: v,
      max,
      color: STATUS_META[k]?.dot
    }));
  });

  const typeBars = createMemo(() => {
    const m = metrics()?.issueTotals?.byType;
    if (!m) {
      return [];
    }
    const max = metricMax(m);
    return Object.entries(m).map(([k, v]) => ({
      label: TYPE_LABEL[k] ?? k,
      value: v,
      max,
      color: k === "bug" ? "#dc2626" : k === "feature" ? "#2563eb" : "#64748b"
    }));
  });

  const priorityBars = createMemo(() => {
    const m = metrics()?.issueTotals?.byPriority;
    if (!m) {
      return [];
    }
    const max = metricMax(m);
    return [0, 1, 2, 3, 4].map((pri) => ({
      label: PRIORITY_META[pri] ?? `P${pri}`,
      value: m[pri] ?? m[String(pri)] ?? 0,
      max,
      color: "#64748b"
    }));
  });

  return (
    <section class="cycle-panel surface-card">
      <div class="cycle-header-row">
        <h2 class="panel-title">{title()}</h2>
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>
          创建 Cycle
        </Btn>
      </div>
      {error() ? <p class="error-text">{error()}</p> : null}
      <div class="cycle-overview-strip">
        <span>总任务 {aggregateSummary().totalIssues}</span>
        <span>进行中 {aggregateSummary().inProgressIssues}</span>
        <span>已完成 {aggregateSummary().doneIssues}</span>
      </div>

      <Show when={metrics()} keyed>
        {(met) => (
          <div class="cycle-metrics-panel">
            <h3 class="cycle-metrics-title">
              团队概览 <span class="muted">· {met.teamName ?? ""}</span>
            </h3>
            <div class="cycle-metrics-kpis">
              <div class="cycle-kpi-chip">
                <span class="muted">任务总数</span>
                <strong>{met.issueTotals?.count ?? 0}</strong>
              </div>
              <div class="cycle-kpi-chip">
                <span class="muted">预估工时 Σ</span>
                <strong>{Number(met.issueTotals?.estimateHours || 0).toFixed(1)} h</strong>
              </div>
            </div>
            <div class="cycle-metrics-charts">
              <div class="cycle-metric-card surface-card">
                <h4 class="cycle-metric-card-title">按状态</h4>
                <For each={statusBars()}>{(row) => <CycleBarRow {...row} />}</For>
              </div>
              <div class="cycle-metric-card surface-card">
                <h4 class="cycle-metric-card-title">按类型</h4>
                <For each={typeBars()}>{(row) => <CycleBarRow {...row} />}</For>
              </div>
              <div class="cycle-metric-card surface-card">
                <h4 class="cycle-metric-card-title">按优先级</h4>
                <For each={priorityBars()}>{(row) => <CycleBarRow {...row} />}</For>
              </div>
            </div>
            <div class="cycle-metric-card surface-card cycle-recent-cycles">
              <h4 class="cycle-metric-card-title">最近迭代完成情况</h4>
              <div class="cycle-recent-table-head">
                <span>名称</span>
                <span>状态</span>
                <span>完成率</span>
                <span>任务</span>
              </div>
              <For each={met.cycles || []}>
                {(c) => (
                  <div class="cycle-recent-row">
                    <span class="cycle-recent-name">{c.name}</span>
                    <span class="muted">{c.status}</span>
                    <span>{Math.round(Number(c.summary?.completionRate || 0))}%</span>
                    <span>
                      {c.summary?.doneIssues ?? 0}/{c.summary?.totalIssues ?? 0}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <ul class="cycle-list">
        {displayed().map((item) => (
          <li class="cycle-row-card" data-key={item.id}>
            <div class="cycle-row-main">
              <strong>{item.name}</strong>
              <TagSpan color={statusTagColor(item.status)}>{statusLabel(item.status)}</TagSpan>
            </div>
            <div class="cycle-row-metrics">
              <span>完成率 {Math.round(Number(item.summary?.completionRate || 0))}%</span>
              <span>总任务 {item.summary?.totalIssues || 0}</span>
              <span>进行中 {item.summary?.inProgressIssues || 0}</span>
              <span>已完成 {item.summary?.doneIssues || 0}</span>
              <span>评审中 {item.summary?.inReviewIssues || 0}</span>
              <span>{item.summary?.scopeCount || 0} scope</span>
            </div>
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
