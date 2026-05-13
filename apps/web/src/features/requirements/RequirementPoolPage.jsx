import { For, Index, Show, createSignal, mergeProps, onMount } from "solid-js";
import { Btn, Inp, Modal, Sel } from "../../ui/primitives.jsx";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client.js";
import { teamSegmentForUrl } from "../../lib/teamSlug.js";

const STATUS_META = {
  draft: { label: "草稿", value: "draft" },
  triaging: { label: "评审中", value: "triaging" },
  ready: { label: "待开工", value: "ready" },
  converted: { label: "已立项", value: "converted" }
};

function statusOptionsForRow(current) {
  const keys = ["draft", "triaging", "ready"];
  if (current === "converted") keys.push("converted");
  return keys.map((k) => ({ value: STATUS_META[k].value, label: STATUS_META[k].label }));
}

function toDatetimeLocalValue(d) {
  const x = new Date(d);
  if (!Number.isFinite(x.getTime())) {
    return "";
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

function defaultCycleBounds() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return { start, end };
}

function urlPreview(u, max = 72) {
  const t = String(u || "").trim();
  if (!t) {
    return "—";
  }
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function RequirementPoolPage(raw) {
  const props = mergeProps(
    {
      workspaceId: "",
      teams: [],
      workspacePathPrefix: "",
      onFlash: undefined,
      onProjectsChanged: undefined,
      navigateTo: undefined
    },
    raw
  );

  const teamsList = () => (Array.isArray(props.teams) ? props.teams : []);

  const [items, setItems] = createSignal([]);
  const [listError, setListError] = createSignal("");

  const [createOpen, setCreateOpen] = createSignal(false);
  const [createTitle, setCreateTitle] = createSignal("");
  const [createPrdUrl, setCreatePrdUrl] = createSignal("");
  const [createOtherFiles, setCreateOtherFiles] = createSignal([{ purpose: "", url: "" }]);
  const [createSaving, setCreateSaving] = createSignal(false);
  const [createErr, setCreateErr] = createSignal("");

  const [editOpen, setEditOpen] = createSignal(false);
  const [editId, setEditId] = createSignal("");
  const [editTitle, setEditTitle] = createSignal("");
  const [editPrdUrl, setEditPrdUrl] = createSignal("");
  const [editOtherFiles, setEditOtherFiles] = createSignal([{ purpose: "", url: "" }]);
  const [editSaving, setEditSaving] = createSignal(false);
  const [editErr, setEditErr] = createSignal("");

  const [convertReq, setConvertReq] = createSignal(null);
  const [cvTeamId, setCvTeamId] = createSignal("");
  const [cvCycleName, setCvCycleName] = createSignal("第一个迭代");
  const [cvStarts, setCvStarts] = createSignal("");
  const [cvEnds, setCvEnds] = createSignal("");
  const [cvSaving, setCvSaving] = createSignal(false);
  const [cvErr, setCvErr] = createSignal("");

  function loadList() {
    return apiGet("/api/requirements")
      .then((data) => {
        setItems(data.items ?? []);
        setListError("");
      })
      .catch(() => setListError("需求列表加载失败"));
  }

  onMount(() => {
    loadList().catch(() => {});
  });

  function openCreate() {
    setCreateErr("");
    setCreateTitle("");
    setCreatePrdUrl("");
    setCreateOtherFiles([{ purpose: "", url: "" }]);
    setCreateOpen(true);
  }

  function closeEdit() {
    if (!editSaving()) {
      setEditOpen(false);
    }
  }

  function openEdit(row) {
    setEditErr("");
    setEditId(row.id);
    setEditTitle(row.title || "");
    setEditPrdUrl(row.prdUrl || "");
    const ofs = Array.isArray(row.otherFiles) && row.otherFiles.length
      ? row.otherFiles.map((f) => ({ purpose: String(f?.purpose ?? ""), url: String(f?.url ?? "") }))
      : [{ purpose: "", url: "" }];
    setEditOtherFiles(ofs);
    setEditOpen(true);
  }

  async function submitEdit(ev) {
    ev?.preventDefault?.();
    const id = editId();
    if (!id || !editTitle().trim()) {
      setEditErr("请填写标题");
      return;
    }
    setEditSaving(true);
    setEditErr("");
    try {
      const otherFiles = editOtherFiles()
        .map((r) => ({
          purpose: String(r.purpose ?? "").trim(),
          url: String(r.url ?? "").trim()
        }))
        .filter((r) => r.url !== "");
      const body = {
        title: editTitle().trim(),
        prdUrl: editPrdUrl().trim() || null,
        otherFiles
      };
      await apiPatch(`/api/requirements/${encodeURIComponent(id)}`, body);
      await loadList();
      setEditOpen(false);
      props.onFlash?.("已保存修改");
    } catch (err) {
      setEditErr(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEditSaving(false);
    }
  }

  function closeCreate() {
    if (!createSaving()) {
      setCreateOpen(false);
    }
  }

  async function submitCreate(ev) {
    ev?.preventDefault?.();
    if (!createTitle().trim()) {
      setCreateErr("请填写标题");
      return;
    }
    setCreateSaving(true);
    setCreateErr("");
    try {
      const otherFiles = createOtherFiles()
        .map((r) => ({
          purpose: String(r.purpose ?? "").trim(),
          url: String(r.url ?? "").trim()
        }))
        .filter((r) => r.url !== "");
      const body = {
        title: createTitle().trim(),
        status: "draft"
      };
      const pu = createPrdUrl().trim();
      if (pu) {
        body.prdUrl = pu;
      }
      if (otherFiles.length) {
        body.otherFiles = otherFiles;
      }
      await apiPost("/api/requirements", body);
      await loadList();
      setCreateOpen(false);
      props.onFlash?.("已保存需求");
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreateSaving(false);
    }
  }

  function openConvert(row) {
    if (row.status === "converted") {
      return;
    }
    setCvErr("");
    setConvertReq(row);
    setCvCycleName("第一个迭代");
    const { start, end } = defaultCycleBounds();
    setCvStarts(toDatetimeLocalValue(start));
    setCvEnds(toDatetimeLocalValue(end));
    const ts = teamsList();
    setCvTeamId(ts.length ? ts[0].id : "");
  }

  function closeConvert() {
    if (!cvSaving()) {
      setConvertReq(null);
    }
  }

  async function submitConvert(ev) {
    ev?.preventDefault?.();
    const row = convertReq();
    if (!row) {
      return;
    }
    if (!cvTeamId().trim()) {
      setCvErr("请选择团队");
      return;
    }
    if (!cvCycleName().trim()) {
      setCvErr("请填写迭代名称");
      return;
    }
    const s = new Date(cvStarts());
    const e = new Date(cvEnds());
    if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) {
      setCvErr("请填写有效的开始与结束时间");
      return;
    }
    setCvSaving(true);
    setCvErr("");
    try {
      const body = {
        teamId: cvTeamId().trim(),
        cycleName: cvCycleName().trim(),
        startsAt: s.toISOString(),
        endsAt: e.toISOString()
      };
      await apiPost(`/api/requirements/${encodeURIComponent(row.id)}/convert`, body);
      await loadList();
      props.onProjectsChanged?.();
      props.onFlash?.("已在所选团队下创建项目迭代");
      setConvertReq(null);
    } catch (err) {
      setCvErr(err instanceof Error ? err.message : "立项失败");
    } finally {
      setCvSaving(false);
    }
  }

  async function patchStatus(row, next) {
    try {
      await apiPatch(`/api/requirements/${encodeURIComponent(row.id)}`, { status: next });
      await loadList();
    } catch {
      props.onFlash?.("状态更新失败");
    }
  }

  async function removeRequirement(row) {
    if (!window.confirm(`确定删除需求「${row.title}」？`)) {
      return;
    }
    try {
      await apiDelete(`/api/requirements/${encodeURIComponent(row.id)}`);
      await loadList();
      props.onFlash?.("已删除");
    } catch {
      props.onFlash?.("删除失败");
    }
  }

  const teamOptions = () => {
    const list = teamsList();
    return [{ value: "", label: "请选择团队" }].concat(list.map((t) => ({ value: t.id, label: t.name || t.id })));
  };

  function teamById(id) {
    return teamsList().find((t) => t.id === id) || null;
  }

  function goCycles(row) {
    const tid = row.convertedTeamId;
    const t = tid ? teamById(tid) : null;
    if (!t) {
      props.onFlash?.("未找到对应团队链接");
      return;
    }
    const seg = teamSegmentForUrl(t);
    const path = `${props.workspacePathPrefix}/workspace/teams/${seg}/cycles`;
    props.navigateTo?.(path);
  }

  return (
    <section class="requirement-pool">
      <div class="project-panel-toolbar requirement-pool-toolbar">
        <Btn type="button" variant="create" onClick={openCreate}>
          录入需求
        </Btn>
      </div>

      {listError() ? <p class="error-text">{listError()}</p> : null}

      <div class="requirement-pool-table-wrap">
        <Show
          when={items().length > 0}
          fallback={
            <div class="project-empty-cards">
              <p class="project-empty-title">需求池为空</p>
              <p class="project-empty-desc muted">
                点击「录入需求」填写标题、PRD 链接与相关文档链接；确认后可通过「立项」在所选团队下创建项目迭代（不创建项目）。
              </p>
            </div>
          }
        >
          <table class="requirement-pool-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>PRD 链接</th>
                <th>其他文件</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <For each={items()}>
                {(row) => (
                  <tr>
                    <td class="req-col-title">{row.title}</td>
                    <td>
                      <Sel
                        class="req-status-sel"
                        aria-label="需求状态"
                        value={row.status}
                        options={statusOptionsForRow(row.status)}
                        onChange={(v) => patchStatus(row, v)}
                      />
                    </td>
                    <td class="muted req-col-prd">
                      <Show when={row.prdUrl} fallback={<span>—</span>}>
                        <a class="req-link" href={row.prdUrl} target="_blank" rel="noopener noreferrer">
                          {urlPreview(row.prdUrl)}
                        </a>
                      </Show>
                    </td>
                    <td class="req-col-files">
                      <ul class="req-att-list">
                        <For each={row.otherFiles || []}>
                          {(f) => (
                            <li class="req-att-row">
                              <a class="req-link" href={f.url} target="_blank" rel="noopener noreferrer">
                                <span class="req-file-purpose">{f.purpose || "其他文件"}</span>
                                <span class="muted req-file-url-preview"> · {urlPreview(f.url, 48)}</span>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                      {!(row.otherFiles || []).length ? <span class="muted">—</span> : null}
                    </td>
                    <td class="req-col-actions">
                      <Btn type="button" variant="text" class="req-action-edit" onClick={() => openEdit(row)}>
                        编辑
                      </Btn>
                      <Show when={row.status !== "converted"}>
                        <Btn type="button" variant="save" class="req-action-start" onClick={() => openConvert(row)}>
                          立项
                        </Btn>
                        <Btn type="button" variant="text" danger class="req-action-del" onClick={() => removeRequirement(row)}>
                          删除
                        </Btn>
                      </Show>
                      <Show when={row.status === "converted" && row.convertedTeamId}>
                        <button type="button" class="btn-ordo btn-ordo-text" onClick={() => goCycles(row)}>
                          迭代列表
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>

      <Modal
        open={createOpen()}
        title="录入需求"
        onClose={closeCreate}
        maskClosable={!createSaving()}
        footer={
          <>
            <Btn type="button" variant="default" disabled={createSaving()} onClick={closeCreate}>
              取消
            </Btn>
            <Btn type="submit" form="req-create-form" variant="create" loading={createSaving()} disabled={createSaving()}>
              保存
            </Btn>
          </>
        }
      >
        <form id="req-create-form" class="project-create-modal-form" onSubmit={submitCreate}>
          {createErr() ? <p class="error-text project-modal-error">{createErr()}</p> : null}
          <label class="project-field-label">
            <span>标题</span>
            <Inp value={createTitle()} onInput={(ev) => setCreateTitle(ev.target.value)} placeholder="一句话说明需求" />
          </label>
          <label class="project-field-label">
            <span>PRD 链接</span>
            <p class="muted req-prd-hint">
              对应迭代卡片中的「产品文档」；立项创建项目迭代时会写入该迭代的「产品文档」链接。
            </p>
            <Inp
              value={createPrdUrl()}
              onInput={(ev) => setCreatePrdUrl(ev.target.value)}
              placeholder="https://…（语雀、飞书、Wiki 等）"
            />
          </label>
          <div class="project-field-label req-other-files-block">
            <span>其他文件</span>
            <p class="muted req-other-files-hint">每条填写「文件用途」与「URL」；无 URL 的行不会保存。可添加多行。</p>
            <Index each={createOtherFiles()}>
              {(row, index) => (
                <div class="req-other-file-row">
                  <Inp
                    class="req-other-purpose"
                    placeholder="用途，如：接口文档"
                    value={row().purpose}
                    onInput={(ev) => {
                      const v = ev.target.value;
                      setCreateOtherFiles((prev) => prev.map((r, j) => (j === index ? { ...r, purpose: v } : r)));
                    }}
                    aria-label={`其他文件用途 ${index + 1}`}
                  />
                  <Inp
                    class="req-other-url"
                    placeholder="https://…"
                    value={row().url}
                    onInput={(ev) => {
                      const v = ev.target.value;
                      setCreateOtherFiles((prev) => prev.map((r, j) => (j === index ? { ...r, url: v } : r)));
                    }}
                    aria-label={`其他文件 URL ${index + 1}`}
                  />
                  <Btn
                    type="button"
                    variant="text"
                    class="req-other-remove"
                    onClick={() => {
                      setCreateOtherFiles((prev) => {
                        const next = prev.filter((_, j) => j !== index);
                        return next.length ? next : [{ purpose: "", url: "" }];
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
              class="req-other-add"
              onClick={() => setCreateOtherFiles((prev) => [...prev, { purpose: "", url: "" }])}
            >
              添加一行
            </Btn>
          </div>
        </form>
      </Modal>

      <Modal
        open={editOpen()}
        title="编辑需求"
        onClose={closeEdit}
        maskClosable={!editSaving()}
        footer={
          <>
            <Btn type="button" variant="default" disabled={editSaving()} onClick={closeEdit}>
              取消
            </Btn>
            <Btn type="submit" form="req-edit-form" variant="save" loading={editSaving()} disabled={editSaving()}>
              保存
            </Btn>
          </>
        }
      >
        <form id="req-edit-form" class="project-create-modal-form" onSubmit={submitEdit}>
          {editErr() ? <p class="error-text project-modal-error">{editErr()}</p> : null}
          <label class="project-field-label">
            <span>标题</span>
            <Inp value={editTitle()} onInput={(ev) => setEditTitle(ev.target.value)} placeholder="一句话说明需求" />
          </label>
          <label class="project-field-label">
            <span>PRD 链接</span>
            <p class="muted req-prd-hint">
              对应迭代卡片中的「产品文档」；立项创建项目迭代时会写入该迭代的「产品文档」链接。
            </p>
            <Inp
              value={editPrdUrl()}
              onInput={(ev) => setEditPrdUrl(ev.target.value)}
              placeholder="https://…（语雀、飞书、Wiki 等）"
            />
          </label>
          <div class="project-field-label req-other-files-block">
            <span>其他文件</span>
            <p class="muted req-other-files-hint">每条填写「文件用途」与「URL」；无 URL 的行不会保存。可添加多行。</p>
            <Index each={editOtherFiles()}>
              {(row, index) => (
                <div class="req-other-file-row">
                  <Inp
                    class="req-other-purpose"
                    placeholder="用途，如：接口文档"
                    value={row().purpose}
                    onInput={(ev) => {
                      const v = ev.target.value;
                      setEditOtherFiles((prev) => prev.map((r, j) => (j === index ? { ...r, purpose: v } : r)));
                    }}
                    aria-label={`其他文件用途 ${index + 1}`}
                  />
                  <Inp
                    class="req-other-url"
                    placeholder="https://…"
                    value={row().url}
                    onInput={(ev) => {
                      const v = ev.target.value;
                      setEditOtherFiles((prev) => prev.map((r, j) => (j === index ? { ...r, url: v } : r)));
                    }}
                    aria-label={`其他文件 URL ${index + 1}`}
                  />
                  <Btn
                    type="button"
                    variant="text"
                    class="req-other-remove"
                    onClick={() => {
                      setEditOtherFiles((prev) => {
                        const next = prev.filter((_, j) => j !== index);
                        return next.length ? next : [{ purpose: "", url: "" }];
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
              class="req-other-add"
              onClick={() => setEditOtherFiles((prev) => [...prev, { purpose: "", url: "" }])}
            >
              添加一行
            </Btn>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(convertReq())}
        title="立项：创建项目迭代"
        onClose={closeConvert}
        wide
        maskClosable={!cvSaving()}
        footer={
          <>
            <Btn type="button" variant="default" disabled={cvSaving()} onClick={closeConvert}>
              取消
            </Btn>
            <Btn type="submit" form="req-convert-form" variant="save" loading={cvSaving()} disabled={cvSaving()}>
              确认创建
            </Btn>
          </>
        }
      >
        <form id="req-convert-form" class="project-create-modal-form" onSubmit={submitConvert}>
          {cvErr() ? <p class="error-text project-modal-error">{cvErr()}</p> : null}
          <p class="muted req-convert-hint">
            在所选团队下创建一条「项目迭代」（kind=project，不挂具体项目）；需求标记为已立项后可从「迭代列表」查看。
            若需求已填写 PRD 链接，将同步写入该迭代的「产品文档」URL（与迭代卡片中「产品文档」一致）。
          </p>
          <label class="project-field-label">
            <span>团队</span>
            <Sel aria-label="团队" value={cvTeamId()} options={teamOptions()} onChange={(v) => setCvTeamId(v)} />
          </label>
          <label class="project-field-label">
            <span>迭代名称</span>
            <Inp value={cvCycleName()} onInput={(ev) => setCvCycleName(ev.target.value)} />
          </label>
          <div class="req-datetime-row">
            <label class="project-field-label">
              <span>开始时间</span>
              <Inp type="datetime-local" value={cvStarts()} onInput={(ev) => setCvStarts(ev.target.value)} />
            </label>
            <label class="project-field-label">
              <span>结束时间</span>
              <Inp type="datetime-local" value={cvEnds()} onInput={(ev) => setCvEnds(ev.target.value)} />
            </label>
          </div>
        </form>
      </Modal>
    </section>
  );
}
