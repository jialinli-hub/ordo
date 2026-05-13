import { createEffect, createSignal, onCleanup } from "solid-js";
import { apiGet } from "../../api/client";

/**  Projects 列表页右侧挂件：与工作区视图一致的风格 */
export function ProjectsAside(props) {
  const [count, setCount] = createSignal(null);
  const [loadFailed, setLoadFailed] = createSignal(false);

  createEffect(() => {
    props.workspaceId;
    props.projectsVersion;
    let cancelled = false;
    setLoadFailed(false);
    setCount(null);
    apiGet("/api/projects")
      .then((data) => {
        if (cancelled) {
          return;
        }
        setCount(Array.isArray(data.items) ? data.items.length : 0);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const countLabel = () => {
    if (loadFailed()) {
      return "—";
    }
    const n = count();
    if (n === null) {
      return "…";
    }
    return String(n);
  };

  return (
    <aside class="dash-aside" aria-label="项目概览">
      <section class="surface-card dash-widget">
        <h2 class="dash-widget-title">工作区快照</h2>
        <p class="dash-widget-kpi">
          <span class="dash-widget-kpi-num">{countLabel()}</span>
          <span class="muted dash-widget-kpi-unit">个项目</span>
        </p>
        <p class="dash-widget-body muted">
          用项目归类任务，之后在 Issue 中选关联项目即可在列表里聚合查看。
        </p>
      </section>

      <section class="surface-card dash-widget dash-widget--accent">
        <h2 class="dash-widget-title">小技巧</h2>
        <ul class="dash-widget-list muted">
          <li>新项目创建后立即可在「任务」里出现在项目筛选中。</li>
          <li>侧栏切换到团队后，可按迭代与视图偏好管理执行节奏。</li>
        </ul>
      </section>
    </aside>
  );
}
