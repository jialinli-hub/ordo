import { createSignal, onMount } from "solid-js";
import { Btn, Inp } from "../../ui/primitives";
import { apiGet, apiPost } from "../../api/client";

export function ProjectList() {
  const [projects, setProjects] = createSignal([]);
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  function loadProjects() {
    return apiGet("/api/projects").then((data) => setProjects(data.items ?? []));
  }

  onMount(() => {
    let active = true;
    loadProjects().catch(() => {
      if (active) {
        setError("项目加载失败");
      }
    });
    return () => {
      active = false;
    };
  });

  async function handleCreate(event) {
    event?.preventDefault?.();
    if (!name().trim()) {
      setError("请输入项目名称");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const project = await apiPost("/api/projects", { name: name().trim() });
      setProjects((prev) => [...prev, project]);
      setName("");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "创建项目失败";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section class="project-panel project-panel--centered surface-card">
      <form class="project-create-group" onSubmit={handleCreate}>
        <Inp
          class="project-create-inp"
          aria-label="项目名称"
          placeholder="项目名称"
          value={name()}
          onInput={(ev) => setName(ev.target.value)}
        />
        <Btn type="submit" variant="primary" loading={saving()} disabled={saving()}>
          创建
        </Btn>
      </form>
      {error() ? <p class="error-text project-centered-error">{error()}</p> : null}
      <p class="muted project-centered-hint">只需填写项目名称。</p>

      <div class="project-list-wrap">
        {projects().length === 0 ? (
          <div class="project-empty-inline">
            <p class="project-empty-title">还没有项目</p>
            <p class="project-empty-desc muted">在上方输入名称并创建，用于归类 Issues。</p>
          </div>
        ) : (
          <ul class="project-list-compact">
            {projects().map((project) => (
              <li data-key={project.id}>
                <div class="project-compact-row" aria-label={project.name}>
                  <span class="project-compact-name">{project.name}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
