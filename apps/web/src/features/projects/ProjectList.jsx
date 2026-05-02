import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Btn, Inp, Modal } from "../../ui/primitives";
import { apiGet, apiPost } from "../../api/client";

export function ProjectList() {
  const [projects, setProjects] = createSignal([]);
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [error, setError] = createSignal("");
  const [modalOpen, setModalOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  let openButtonEl;
  let dialogFormEl;

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

  createEffect(() => {
    if (!modalOpen()) {
      return;
    }
    const id = window.setTimeout(() => dialogFormEl?.querySelector("input")?.focus(), 0);
    onCleanup(() => window.clearTimeout(id));
  });

  function closeModal() {
    setModalOpen(false);
    setName("");
    setKey("");
    setError("");
    openButtonEl?.focus();
  }

  async function handleCreate(event) {
    event?.preventDefault?.();
    if (!name().trim() || !key().trim()) {
      setError("请输入项目名称和 Key");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const project = await apiPost("/api/projects", { name: name().trim(), key: key().trim() });
      setProjects((prev) => [...prev, project]);
      closeModal();
    } catch (err) {
      if (err?.status === 409) {
        setError("Project Key 已存在");
      } else {
        setError("创建项目失败");
      }
    } finally {
      setSaving(false);
    }
  }

  function visibleProjects() {
    const keyword = query().trim().toLowerCase();
    return projects().filter((project) => {
      if (!keyword) {
        return true;
      }
      const k = (project.key || "").toLowerCase();
      return project.name.toLowerCase().includes(keyword) || k.includes(keyword);
    });
  }

  const q = query().trim();

  return (
    <section class="project-panel surface-card">
      <div class="project-toolbar">
        <div class="project-search-wrap">
          <Inp
            aria-label="Project search"
            class="project-search"
            placeholder="按名称或 Key 搜索"
            value={query()}
            onInput={(ev) => setQuery(ev.target.value)}
          />
        </div>
        <Btn variant="primary" ref={(el) => (openButtonEl = el)} onClick={() => setModalOpen(true)}>
          创建项目
        </Btn>
      </div>
      {error() && !modalOpen() ? <p class="error-text">{error()}</p> : null}
      <ul class="project-list-plain">
        {visibleProjects().length === 0 ? (
          <li class="project-empty-state">
            {projects().length === 0 ? (
              <>
                <p class="project-empty-title">还没有项目</p>
                <p class="project-empty-desc muted">创建第一个项目，用于归类 Issues 与协作。</p>
              </>
            ) : (
              <>
                <p class="project-empty-title">未找到匹配项</p>
                <p class="project-empty-desc muted">
                  {q ? `没有与「${q}」相符的项目，试试别的关键词。` : "暂无结果。"}
                </p>
              </>
            )}
          </li>
        ) : null}
        {visibleProjects().map((project) => {
          const rawKey = typeof project.key === "string" ? project.key.trim() : "";
          const label = [project.name, rawKey].filter(Boolean).join(", ");
          const initial =
            project.name && project.name.trim().charAt(0)
              ? project.name.trim().charAt(0).toUpperCase()
              : "?";
          return (
            <li data-key={project.id}>
              <div class="project-item-card" aria-label={label}>
                <span class="project-avatar" aria-hidden>
                  {initial}
                </span>
                <div class="project-item-body">
                  <span class="project-name">{project.name}</span>
                  {rawKey ? (
                    <code class="project-key-chip">{rawKey}</code>
                  ) : (
                    <span class="project-key-missing muted">未设置 Key</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={modalOpen()}
        title="创建项目"
        onClose={() => !saving() && closeModal()}
        footer={
          <>
            <Btn variant="default" onClick={() => !saving() && closeModal()}>
              取消
            </Btn>
            <Btn variant="primary" loading={saving()} disabled={saving()} onClick={(e) => handleCreate(e)}>
              {saving() ? "创建中…" : "创建"}
            </Btn>
          </>
        }
      >
        <form ref={dialogFormEl} class="modal-form" onSubmit={handleCreate}>
          <label class="modal-field">
            <span>名称</span>
            <Inp
              aria-label="Project name"
              placeholder="项目名称"
              value={name()}
              onInput={(event) => setName(event.target.value)}
            />
          </label>
          <label class="modal-field">
            <span>Key</span>
            <Inp
              aria-label="Project key"
              placeholder="项目 Key"
              value={key()}
              onInput={(event) => setKey(event.target.value)}
            />
          </label>
          {error() ? <p class="error-text">{error()}</p> : null}
        </form>
      </Modal>
    </section>
  );
}
