import { createSignal, createMemo, onMount } from "solid-js";

export function DingTalkLogin() {
  const [error, setError] = createSignal("");
  let qrHost;
  const clientId = import.meta.env.VITE_DINGTALK_CLIENT_ID;
  const redirectUri = `${window.location.origin}/dingtalk/callback`;

  /** 完整浏览器授权页（非 iframe）：钉钉侧可与电脑版钉钉联动，已登录时通常可一键确认；与内嵌二维码的「仅扫码」能力不同 */
  const desktopOAuthUrl = createMemo(() => {
    if (!clientId) {
      return "";
    }
    const qs = new URLSearchParams({
      redirect_uri: redirectUri,
      response_type: "code",
      client_id: clientId,
      scope: "openid",
      state: "ordo_login",
      prompt: "consent"
    });
    return `https://login.dingtalk.com/oauth2/auth?${qs.toString()}`;
  });

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
        <h1 id="login-heading" class="login-title">
          登录 Ordo
        </h1>
        <p class="login-lede">
          使用手机钉钉扫描下方二维码；若本机已登录<strong>电脑版钉钉</strong>，可将鼠标移到二维码区域，在出现的面板中打开浏览器授权页（与钉钉客户端内体验类似，已登录时通常可一键确认）。
        </p>
      </header>

      {!clientId ? (
        <div class="login-config-missing">
          <p>
            未配置 <code>VITE_DINGTALK_CLIENT_ID</code>，无法展示二维码。
          </p>
        </div>
      ) : (
        <div class="login-qr-wrap">
          <div class="login-qr-interactive">
            <div class="login-qr-frame-slot">
              <div class="login-qr-frame">
                <div id="dingtalk-qrcode" ref={qrHost} class="login-qr-host" />
              </div>
            </div>
            <div class="login-qr-pc-pop" role="region" aria-label="电脑端钉钉登录">
              <p class="login-qr-pc-pop-title">电脑端钉钉</p>
              <p class="login-qr-pc-pop-desc muted">
                在浏览器打开钉钉授权页。若本机已登录电脑版钉钉，授权页上一般会显示当前账号并可快速确认。
              </p>
              <a class="login-qr-pc-pop-cta" href={desktopOAuthUrl()} target="_self" rel="noopener noreferrer">
                打开授权页登录
              </a>
            </div>
          </div>
          <p class="login-qr-hint">手机扫码：打开钉钉 → 扫一扫</p>
        </div>
      )}

      {error() ? <p class="error-text login-error">{error()}</p> : null}
    </section>
  );
}
