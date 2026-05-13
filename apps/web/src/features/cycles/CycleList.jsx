import { For, Index, Show, createEffect, createMemo, createSignal, on, onMount, untrack } from "solid-js";
import { Btn, Inp, Modal, Sel, TagSpan } from "../../ui/primitives.jsx";
import { apiGet, apiPatch, apiPost } from "../../api/client";
import { GROUP_ORDER, STATUS_META, TYPE_LABEL } from "../issues/issueUi";

/** `<input type="date">` 值为 YYYY-MM-DD 时，按本地日历日 0 点 / 当日最后一刻 转 ISO，避免 `new Date("YYYY-MM-DD")` 被当作 UTC 午夜导致与国内时区错位 */
function dateInputToLocalDayStartIso(dateStr) {
  const s = String(dateStr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((x) => Number(x));
    return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  }
  return new Date(dateStr).toISOString();
}

function dateInputToLocalDayEndIso(dateStr) {
  const s = String(dateStr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((x) => Number(x));
    return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
  }
  return new Date(dateStr).toISOString();
}

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

const CYCLE_KIND_OPTIONS = [
  { value: "daily", label: "日常迭代" },
  { value: "project", label: "项目迭代" }
];

const RELEASE_COND_STATUS_OPTIONS = [
  { value: "pending", label: "待完成" },
  { value: "done", label: "已完成" }
];

/** 迭代卡片内：发布条件 + 每条状态下拉，失焦或改状态即 PATCH。
 *  禁止在 createEffect 中跟随 props.initial / 服务端 updatedAt 同步 rows：同一张卡片上改迭代类型、日期等任意 PATCH 都会刷新 updatedAt，若据此重置 rows 会覆盖正在输入的文案（表现为「一次只能输一个字符」）。仅当切换到另一条 cycle（cycleId 变化）时再从 props 拉取。列表行用 `<Index>` 稳定 DOM，避免受控输入在每次 setRows 后被整表重建。 */
function CycleReleaseConditionsBlock(props) {
  const [rows, setRows] = createSignal([{ text: "", status: "pending" }]);

  function applyInitialFromProps() {
    const init = untrack(() => props.initial);
    if (!Array.isArray(init) || init.length === 0) {
      setRows([{ text: "", status: "pending" }]);
    } else {
      setRows(
        init.map((x) => ({
          text: String(x?.text ?? ""),
          status: x?.status === "done" ? "done" : "pending"
        }))
      );
    }
  }

  createEffect(
    on(
      () => props.cycleId,
      () => {
        applyInitialFromProps();
      }
    )
  );

  async function commit(nextRows) {
    const cleaned = nextRows
      .map((r) => ({ text: r.text.trim(), status: r.status === "done" ? "done" : "pending" }))
      .filter((r) => r.text !== "");
    await props.onSave(cleaned);
    if (cleaned.length === 0) {
      setRows([{ text: "", status: "pending" }]);
    } else {
      setRows(cleaned.map((c) => ({ text: c.text, status: c.status })));
    }
  }

  return (
    <div class="cycle-release-conds">
      <span class="cycle-meta-kicker muted">发布条件</span>
      <Index each={rows()}>
        {(row, index) => (
          <div class="cycle-release-cond-row">
            <Inp
              class="cycle-release-cond-text"
              placeholder="例如：主干回归通过"
              value={row().text}
              onInput={(e) => {
                const v = e.target.value;
                setRows((prev) => prev.map((r, j) => (j === index ? { ...r, text: v } : r)));
              }}
              onBlur={() => commit(rows())}
              aria-label={`发布条件 ${index + 1}`}
            />
            <Sel
              class="cycle-release-cond-status"
              value={row().status}
              options={RELEASE_COND_STATUS_OPTIONS}
              onChange={async (v) => {
                const st = v === "done" ? "done" : "pending";
                const next = rows().map((r, j) => (j === index ? { ...r, status: st } : r));
                setRows(next);
                await commit(next);
              }}
              aria-label={`发布条件 ${index + 1} 状态`}
            />
            <Btn
              type="button"
              variant="text"
              class="cycle-release-cond-remove"
              aria-label="移除此条件"
              onClick={async () => {
                const next = rows().filter((_, j) => j !== index);
                const final = next.length ? next : [{ text: "", status: "pending" }];
                setRows(final);
                await commit(final);
              }}
            >
              移除
            </Btn>
          </div>
        )}
      </Index>
      <Btn
        type="button"
        variant="text"
        class="cycle-release-cond-add"
        onClick={() => setRows((prev) => [...prev, { text: "", status: "pending" }])}
      >
        添加条件
      </Btn>
    </div>
  );
}

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

function CycleDocUrlField(props) {
  const [draft, setDraft] = createSignal(props.value ?? "");
  createEffect(() => {
    setDraft(props.value ?? "");
  });
  return (
    <Inp
      class="cycle-doc-url-input"
      placeholder={props.placeholder}
      value={draft()}
      onInput={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft().trim();
        const prev = String(props.value ?? "").trim();
        if (v !== prev) {
          props.onSave?.(v);
        }
      }}
      aria-label={props["aria-label"]}
    />
  );
}

export function CycleList(props) {
  const cycleView = () => props.cycleView ?? "all";
  const title = () => props.title ?? "Cycles";
  const teamId = () => props.teamId ?? "";

  const [items, setItems] = createSignal([]);
  const [name, setName] = createSignal("");
  const [createKind, setCreateKind] = createSignal("daily");
  const [startsAt, setStartsAt] = createSignal("");
  const [endsAt, setEndsAt] = createSignal("");
  const [plannedTestAtCreate, setPlannedTestAtCreate] = createSignal("");
  const [releaseAtCreate, setReleaseAtCreate] = createSignal("");
  const [productDocCreate, setProductDocCreate] = createSignal("");
  const [designDocCreate, setDesignDocCreate] = createSignal("");
  const [uiDocCreate, setUiDocCreate] = createSignal("");
  const [createReleaseConds, setCreateReleaseConds] = createSignal([{ text: "", status: "pending" }]);
  const [error, setError] = createSignal("");
  const [createOpen, setCreateOpen] = createSignal(false);

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

  function resetCreateForm() {
    setName("");
    setCreateKind("daily");
    setStartsAt("");
    setEndsAt("");
    setPlannedTestAtCreate("");
    setReleaseAtCreate("");
    setProductDocCreate("");
    setDesignDocCreate("");
    setUiDocCreate("");
    setCreateReleaseConds([{ text: "", status: "pending" }]);
  }

  async function handleCreateCycle(event) {
    event?.preventDefault?.();
    if (!name() || !startsAt() || !endsAt()) {
      setError("请填写完整的 Cycle 信息");
      return;
    }
    setError("");
    try {
      const body = {
        name: name().trim(),
        kind: createKind(),
        startsAt: dateInputToLocalDayStartIso(startsAt()),
        endsAt: dateInputToLocalDayEndIso(endsAt())
      };
      const tid = teamId();
      if (tid) {
        body.teamId = tid;
      }
      const pt = plannedTestAtCreate().trim();
      if (pt) {
        body.plannedTestAt = pt;
      }
      const rel = releaseAtCreate().trim();
      if (rel) {
        body.releaseAt = rel;
      }
      if (createKind() === "project") {
        const p = productDocCreate().trim();
        const d = designDocCreate().trim();
        const u = uiDocCreate().trim();
        if (p) body.productDocUrl = p;
        if (d) body.designDocUrl = d;
        if (u) body.uiDocUrl = u;
      }
      const rc = createReleaseConds()
        .map((r) => ({
          text: String(r.text ?? "").trim(),
          status: r.status === "done" ? "done" : "pending"
        }))
        .filter((r) => r.text !== "");
      if (rc.length) {
        body.releaseConditions = rc;
      }
      await apiPost("/api/cycles", body);
      resetCreateForm();
      setCreateOpen(false);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "创建 Cycle 失败");
    }
  }

  function dateIsoToInput(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 10);
  }

  async function patchCycle(cycleId, partial) {
    try {
      await apiPatch(`/api/cycles/${encodeURIComponent(cycleId)}`, partial);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "更新迭代失败");
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
        <Btn variant="create" onClick={() => setCreateOpen(true)}>
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
                  <div class="cycle-row-tags">
                    <TagSpan color={statusTagColor(computeCycleStatus(item.startsAt, item.endsAt))}>
                      {statusLabel(computeCycleStatus(item.startsAt, item.endsAt))}
                    </TagSpan>
                    <TagSpan color={item.kind === "project" ? "processing" : "default"}>
                      {item.kind === "project" ? "项目迭代" : "日常迭代"}
                    </TagSpan>
                  </div>
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
              <div class="cycle-row-col cycle-row-col--meta">
                <div class="cycle-meta-block">
                  <span class="cycle-meta-kicker muted">迭代类型</span>
                  <Sel
                    class="cycle-kind-select"
                    aria-label={`迭代类型 ${item.name}`}
                    value={item.kind === "project" ? "project" : "daily"}
                    options={CYCLE_KIND_OPTIONS}
                    onChange={(v) => patchCycle(item.id, { kind: v || "daily" })}
                  />
                  <div class="cycle-meta-dates">
                    <label class="cycle-meta-date-field">
                      <span class="muted">提测</span>
                      <Inp
                        type="date"
                        value={dateIsoToInput(item.plannedTestAt)}
                        aria-label={`提测日期 ${item.name}`}
                        onBlur={(e) =>
                          patchCycle(item.id, { plannedTestAt: e.target.value || "" })
                        }
                      />
                    </label>
                    <label class="cycle-meta-date-field">
                      <span class="muted">发布</span>
                      <Inp
                        type="date"
                        value={dateIsoToInput(item.releaseAt)}
                        aria-label={`发布日期 ${item.name}`}
                        onBlur={(e) =>
                          patchCycle(item.id, { releaseAt: e.target.value || "" })
                        }
                      />
                    </label>
                  </div>
                  <CycleReleaseConditionsBlock
                    cycleId={item.id}
                    initial={item.releaseConditions}
                    onSave={(cleaned) => patchCycle(item.id, { releaseConditions: cleaned })}
                  />
                  <Show when={item.kind === "project"}>
                    <div class="cycle-meta-docs">
                      <span class="cycle-meta-kicker muted">文档链接</span>
                      <CycleDocUrlField
                        placeholder="产品文档 URL"
                        value={item.productDocUrl}
                        aria-label={`产品文档 ${item.name}`}
                        onSave={(v) => patchCycle(item.id, { productDocUrl: v || "" })}
                      />
                      <CycleDocUrlField
                        placeholder="设计文档 URL"
                        value={item.designDocUrl}
                        aria-label={`设计文档 ${item.name}`}
                        onSave={(v) => patchCycle(item.id, { designDocUrl: v || "" })}
                      />
                      <CycleDocUrlField
                        placeholder="UI 文档 URL"
                        value={item.uiDocUrl}
                        aria-label={`UI 文档 ${item.name}`}
                        onSave={(v) => patchCycle(item.id, { uiDocUrl: v || "" })}
                      />
                    </div>
                  </Show>
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
        class="oro-modal-cycle-create"
        open={createOpen()}
        title="创建 Cycle"
        onClose={() => {
          setCreateOpen(false);
          resetCreateForm();
        }}
        footer={
          <>
            <Btn
              variant="default"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
            >
              取消
            </Btn>
            <Btn variant="create" onClick={(e) => handleCreateCycle(e)}>
              创建
            </Btn>
          </>
        }
      >
        <form class="cycle-form cycle-form-create" onSubmit={handleCreateCycle}>
          <div class="cycle-form-field">
            <label class="cycle-form-label" for="cycle-create-name">
              迭代名称
            </label>
            <Inp
              id="cycle-create-name"
              placeholder="例如 Sprint 12"
              value={name()}
              onInput={(event) => setName(event.target.value)}
            />
          </div>
          <div class="cycle-form-field">
            <label class="cycle-form-label" for="cycle-create-kind">
              迭代类型
            </label>
            <Sel
              id="cycle-create-kind"
              value={createKind()}
              options={CYCLE_KIND_OPTIONS}
              onChange={(v) => setCreateKind(v || "daily")}
            />
          </div>
          <div class="cycle-form-field cycle-form-field--span">
            <span class="cycle-form-label">迭代周期（起止）</span>
            <div class="cycle-form-row-dates">
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-starts">
                  开始日期
                </label>
                <Inp
                  id="cycle-create-starts"
                  type="date"
                  value={startsAt()}
                  onInput={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-ends">
                  结束日期
                </label>
                <Inp
                  id="cycle-create-ends"
                  type="date"
                  value={endsAt()}
                  onInput={(event) => setEndsAt(event.target.value)}
                />
              </div>
            </div>
          </div>
          <div class="cycle-form-field cycle-form-field--span">
            <span class="cycle-form-label">里程碑（可选）</span>
            <div class="cycle-form-row-dates">
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-test">
                  提测日期
                </label>
                <Inp
                  id="cycle-create-test"
                  type="date"
                  value={plannedTestAtCreate()}
                  onInput={(e) => setPlannedTestAtCreate(e.target.value)}
                />
              </div>
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-release">
                  发布日期
                </label>
                <Inp
                  id="cycle-create-release"
                  type="date"
                  value={releaseAtCreate()}
                  onInput={(e) => setReleaseAtCreate(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div class="cycle-form-field cycle-form-field--span">
            <span class="cycle-form-label">发布条件（可选）</span>
            <Index each={createReleaseConds()}>
              {(row, index) => (
                <div class="cycle-release-cond-row cycle-release-cond-row--create">
                  <Inp
                    placeholder="例如：主干回归通过"
                    value={row().text}
                    onInput={(e) => {
                      const v = e.target.value;
                      setCreateReleaseConds((prev) => prev.map((r, j) => (j === index ? { ...r, text: v } : r)));
                    }}
                    aria-label={`新建迭代发布条件 ${index + 1}`}
                  />
                  <Sel
                    class="cycle-release-cond-status"
                    value={row().status}
                    options={RELEASE_COND_STATUS_OPTIONS}
                    onChange={(v) => {
                      const st = v === "done" ? "done" : "pending";
                      setCreateReleaseConds((prev) => prev.map((r, j) => (j === index ? { ...r, status: st } : r)));
                    }}
                    aria-label={`新建迭代发布条件 ${index + 1} 状态`}
                  />
                  <Btn
                    type="button"
                    variant="text"
                    class="cycle-release-cond-remove"
                    onClick={() => {
                      setCreateReleaseConds((prev) => {
                        const next = prev.filter((_, j) => j !== index);
                        return next.length ? next : [{ text: "", status: "pending" }];
                      });
                    }}
                  >
                    移除
                  </Btn>
                </div>
              )}
            </Index>
            <Btn
              type="button"
              variant="text"
              class="cycle-release-cond-add"
              onClick={() =>
                setCreateReleaseConds((prev) => [...prev, { text: "", status: "pending" }])
              }
            >
              添加条件
            </Btn>
          </div>
          <Show when={createKind() === "project"}>
            <div class="cycle-form-field cycle-form-field--span">
              <span class="cycle-form-label">项目文档链接（可选）</span>
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-product-doc">
                  产品文档 URL
                </label>
                <Inp
                  id="cycle-create-product-doc"
                  placeholder="https://…"
                  value={productDocCreate()}
                  onInput={(e) => setProductDocCreate(e.target.value)}
                />
              </div>
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-design-doc">
                  设计文档 URL
                </label>
                <Inp
                  id="cycle-create-design-doc"
                  placeholder="https://…"
                  value={designDocCreate()}
                  onInput={(e) => setDesignDocCreate(e.target.value)}
                />
              </div>
              <div class="cycle-form-field">
                <label class="cycle-form-sub-label" for="cycle-create-ui-doc">
                  UI 文档 URL
                </label>
                <Inp
                  id="cycle-create-ui-doc"
                  placeholder="https://…"
                  value={uiDocCreate()}
                  onInput={(e) => setUiDocCreate(e.target.value)}
                />
              </div>
            </div>
          </Show>
        </form>
      </Modal>
    </section>
  );
}
