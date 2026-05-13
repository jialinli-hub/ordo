import { For, Show, createEffect, createSignal, mergeProps, onMount } from "solid-js";
import { Btn, Inp, Modal, Sel, TextArea } from "../../ui/primitives";
import { apiGet, apiPost } from "../../api/client";

function formatProjectDescription(project) {
  const raw = project?.description;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return "暂无描述";
}

function formatProjectLead(project) {
  const lead = project?.lead;
  if (lead && typeof lead === "object") {
    const name = lead.name != null ? String(lead.name).trim() : "";
    const email = lead.email != null ? String(lead.email).trim() : "";
    if (name) {
      return name;
    }
    if (email) {
      return email;
    }
  }
  return "未指定";
}

export function ProjectList(raw) {
  const props = mergeProps({ workspaceId: "", focusProjectId: "", onProjectsChanged: undefined }, raw);
  const workspaceId = () => props.workspaceId ?? "";

  const [projects, setProjects] = createSignal([]);
  const [members, setMembers] = createSignal([]);
  const [modalOpen, setModalOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [leadUserId, setLeadUserId] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  function loadProjects() {
    return apiGet("/api/projects").then((data) => setProjects(data.items ?? []));
  }

  function loadMembers() {
    const wid = workspaceId();
    if (!wid) {
      return Promise.resolve();
    }
    return apiGet(`/api/workspaces/${encodeURIComponent(wid)}/members`).then((data) =>
      setMembers(data.items ?? [])
    );
  }

  onMount(() => {
    let active = true;
    loadProjects().catch(() => {
      if (active) {
        setError("项目加载失败");
      }
    });
    loadMembers().catch(() => {});
    return () => {
      active = false;
    };
  });

  createEffect(() => {
    const id = String(props.focusProjectId || "").trim();
    if (!id) {
      return;
    }
    const list = projects();
    if (!list.some((row) => row.id === id)) {
      return;
    }
    requestAnimationFrame(() => {
      try {
        const el = document.querySelector(`[data-project-card-id="${id.replace(/"/g, "")}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch {
        /* ignore selector issues */
      }
    });
  });

  function openModal() {
    setError("");
    setName("");
    setDescription("");
    setLeadUserId("");
    setModalOpen(true);
    loadMembers().catch(() => {});
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function handleCreate(event) {
    event?.preventDefault?.();
    if (!name().trim()) {
      setError("请输入项目名称");
      return;
    }
    if (!leadUserId().trim()) {
      setError("请选择负责人");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const project = await apiPost("/api/projects", {
        name: name().trim(),
        description: description().trim(),
        leadUserId: leadUserId().trim()
      });
      setProjects((prev) => [project, ...prev]);
      props.onProjectsChanged?.();
      closeModal();
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "创建项目失败";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const memberOptions = () => {
    const rows = members();
    return [{ value: "", label: "请选择负责人" }].concat(
      rows.map((m) => ({
        value: m.userId,
        label: m.name || m.email || m.userId
      }))
    );
  };

  return (
    <section class="project-panel project-panel-dash">
      <div class="project-panel-toolbar">
        <Btn type="button" variant="create" onClick={openModal}>
          新建项目
        </Btn>
      </div>

      {error() && !modalOpen() ? <p class="error-text project-inline-error">{error()}</p> : null}

      <div class="project-card-grid-area">
        <Show
          when={projects().length > 0}
          fallback={
            <div class="project-empty-cards">
              <p class="project-empty-title">还没有项目</p>
              <p class="project-empty-desc muted">点击「新建项目」添加名称、描述并指定负责人。</p>
            </div>
          }
        >
          <div class="project-card-grid">
            <For each={projects()}>
              {(project) => (
                <article
                  class={`project-mini-card${String(props.focusProjectId || "").trim() === project.id ? " project-mini-card--focused" : ""}`}
                  data-key={project.id}
                  data-project-card-id={project.id}
                  aria-label={project.name}
                >
                  <h3 class="project-mini-card-title">{project.name}</h3>
                  <p class="project-mini-desc muted">{formatProjectDescription(project)}</p>
                  <div class="project-mini-meta muted">
                    <span class="project-mini-lead-label">负责人</span>
                    <span class="project-mini-lead-name">{formatProjectLead(project)}</span>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Modal
        open={modalOpen()}
        title="新建项目"
        onClose={() => {
          if (!saving()) {
            closeModal();
          }
        }}
        maskClosable={!saving()}
        footer={
          <>
            <Btn type="button" variant="default" disabled={saving()} onClick={closeModal}>
              取消
            </Btn>
            <Btn type="submit" form="project-create-form" variant="create" loading={saving()} disabled={saving()}>
              创建
            </Btn>
          </>
        }
      >
        <form id="project-create-form" class="project-create-modal-form" onSubmit={handleCreate}>
          {error() && modalOpen() ? <p class="error-text project-modal-error">{error()}</p> : null}
          <label class="project-field-label">
            <span>项目名称</span>
            <Inp
              aria-label="项目名称"
              placeholder="例如：核心平台"
              value={name()}
              onInput={(ev) => setName(ev.target.value)}
            />
          </label>
          <label class="project-field-label">
            <span>描述</span>
            <TextArea
              aria-label="项目描述"
              placeholder="简要说明项目目标或范围（可选）"
              rows={4}
              value={description()}
              onInput={(ev) => setDescription(ev.target.value)}
            />
          </label>
          <label class="project-field-label">
            <span>负责人</span>
            <Sel
              aria-label="负责人"
              value={leadUserId()}
              options={memberOptions()}
              onChange={(v) => setLeadUserId(v)}
            />
          </label>
        </form>
      </Modal>
    </section>
  );
}
