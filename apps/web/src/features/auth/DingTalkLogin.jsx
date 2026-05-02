import { createSignal, onMount } from "solid-js";

export function DingTalkLogin() {
  const [error, setError] = createSignal("");
  let qrHost;
  const clientId = import.meta.env.VITE_DINGTALK_CLIENT_ID;
  const redirectUri = `${window.location.origin}/dingtalk/callback`;

  onMount(() => {
    if (!clientId || !qrHost || !window.DTFrameLogin) {
      return;
    }
    qrHost.innerHTML = "";
    window.DTFrameLogin(
      {
        id: "dingtalk-qrcode",
        width: 300,
        height: 300
      },
      {
        redirect_uri: encodeURIComponent(redirectUri),
        client_id: clientId,
        scope: "openid",
        response_type: "code",
        state: "ordo_login",
        prompt: "consent"
      },
      (loginResult) => {
        window.location.href = loginResult.redirectUrl;
      },
      () => {
        setError("二维码加载失败，请刷新重试");
      }
    );
  });

  return (
    <section class="login-card" aria-labelledby="login-heading">
      <header class="login-card-header">
        <div class="login-badge" aria-hidden>
          <span class="login-badge-icon">钉</span>
          <span>钉钉</span>
        </div>
        <h1 id="login-heading" class="login-title">
          登录 Ordo
        </h1>
        <p class="login-lede">使用钉钉 App 扫描下方二维码，安全进入你的工作区。</p>
        <p class="login-provider-note">钉钉登录</p>
      </header>

      {!clientId ? (
        <div class="login-config-missing">
          <p>
            未配置 <code>VITE_DINGTALK_CLIENT_ID</code>，无法展示二维码。
          </p>
        </div>
      ) : (
        <div class="login-qr-wrap">
          <div class="login-qr-frame">
            <div id="dingtalk-qrcode" ref={qrHost} class="login-qr-host" />
          </div>
          <p class="login-qr-hint">打开钉钉 → 扫一扫</p>
        </div>
      )}

      {error() ? <p class="error-text login-error">{error()}</p> : null}
    </section>
  );
}
