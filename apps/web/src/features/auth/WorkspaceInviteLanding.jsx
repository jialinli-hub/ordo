import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { DingTalkLogin } from "./DingTalkLogin.jsx";
import { Btn } from "../../ui/primitives.jsx";
import { apiGet } from "../../api/client";

function roleLabel(role) {
  if (role === "owner") {
    return "所有者";
  }
  if (role === "admin") {
    return "管理员";
  }
  return "成员";
}

/**
 * @param {object} p
 * @param {import("solid-js").JSX.Element} [p.themeSwitch]
 * @param {() => boolean} p.loggedIn
 * @param {() => string} [p.authError]
 * @param {() => string} p.inviteToken
 * @param {() => string} p.teamHint
 * @param {(preview: Record<string, unknown> | null) => Promise<void>} p.onAccept
 * @param {() => void} [p.onLeaveWithoutJoining]
 */
export function WorkspaceInviteLanding(p) {
  const [preview, setPreview] = createSignal(null);
  const [previewErr, setPreviewErr] = createSignal("");
  const [previewLoading, setPreviewLoading] = createSignal(true);
  const [acceptBusy, setAcceptBusy] = createSignal(false);
  const [acceptErr, setAcceptErr] = createSignal("");

  createEffect(() => {
    p.inviteToken();
    p.teamHint();
    const token = p.inviteToken().trim();
    const teamHint = p.teamHint().trim();
    if (!token) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewErr("邀请链接无效或缺少 token。");
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewErr("");
    setPreview(null);

    const qs = new URLSearchParams({ token });
    if (teamHint) {
      qs.set("team", teamHint);
    }

    apiGet(`/api/workspace-invites/preview?${qs.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
          setPreviewLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const status = err?.status;
          const msg =
            status === 410
              ? "邀请已过期。"
              : status === 404
                ? "邀请不存在或已被撤销。"
                : "无法加载邀请信息，请稍后重试。";
          setPreviewErr(msg);
          setPreviewLoading(false);
        }
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  async function handleAccept() {
    const data = preview();
    setAcceptErr("");
    setAcceptBusy(true);
    try {
      await p.onAccept(data);
    } catch (err) {
      const status = err?.status;
      const msg =
        status === 401
          ? "请先登录。"
          : status === 410
            ? "邀请已过期。"
            : status === 404
              ? "邀请无效。"
              : err instanceof Error && err.message
                ? err.message
                : "无法接受邀请，请稍后重试。";
      setAcceptErr(msg);
    } finally {
      setAcceptBusy(false);
    }
  }

  const authBanner = () => (typeof p.authError === "function" ? p.authError() : "") || "";

  return (
    <main class="auth-layout auth-layout--splash">
      <div class="auth-splash-bg" aria-hidden />
      <div class="auth-splash-inner auth-splash-inner--narrow">
        {p.themeSwitch ?? null}

        <div class="splash-brand splash-brand--compact">
          <span class="splash-logo-mark">O</span>
          <div class="splash-brand-text">
            <span class="splash-logo-word">Ordo</span>
            <span class="splash-tagline">工作区邀请</span>
          </div>
        </div>

        <section class="surface-card invite-preview-card">
          <Show when={previewLoading()}>
            <p class="muted">正在加载邀请信息…</p>
          </Show>

          <Show when={!previewLoading() && previewErr()}>
            <p class="error-text">{previewErr()}</p>
          </Show>

          <Show when={!previewLoading() && !previewErr() && preview()}>
            {(pv) => {
              const row = pv();
              const ws = row?.workspace || {};
              const team = row?.team;
              return (
                <>
                  <h2 class="invite-preview-heading">你将加入</h2>
                  <dl class="invite-preview-dl">
                    <dt>Workspace</dt>
                    <dd>{ws.name ?? "—"}</dd>
                    {team?.name ? (
                      <>
                        <dt>团队</dt>
                        <dd>{team.name}</dd>
                      </>
                    ) : null}
                    <dt>角色</dt>
                    <dd>{roleLabel(row?.role)}</dd>
                    <dt>有效期至</dt>
                    <dd>
                      <time dateTime={String(row?.expiresAt || "")}>
                        {row?.expiresAt ? new Date(String(row.expiresAt)).toLocaleString("zh-CN") : "—"}
                      </time>
                    </dd>
                  </dl>
                </>
              );
            }}
          </Show>

          <Show when={authBanner()}>
            <p class="error-text auth-error-banner">{authBanner()}</p>
          </Show>

          <Show when={!p.loggedIn()}>
            <p class="muted invite-preview-login-hint">使用钉钉账号登录后，点击下方按钮接受邀请。</p>
            <DingTalkLogin />
          </Show>

          <Show when={p.loggedIn() && !previewLoading() && !previewErr()}>
            <div class="invite-preview-actions">
              <Btn variant="save" loading={acceptBusy()} disabled={acceptBusy()} type="button" onClick={() => handleAccept()}>
                接受邀请并加入
              </Btn>
            </div>
          </Show>

          <Show when={acceptErr()}>
            <p class="error-text invite-preview-error">{acceptErr()}</p>
          </Show>

          <Show when={typeof p.onLeaveWithoutJoining === "function"}>
            <button type="button" class="link-button invite-dismiss" onClick={() => p.onLeaveWithoutJoining?.()}>
              暂不加入
            </button>
          </Show>
        </section>
      </div>
    </main>
  );
}
