import { useEffect, useRef, useState } from "react";

export function DingTalkLogin() {
  const [error, setError] = useState("");
  const qrcodeRef = useRef(null);
  const clientId = import.meta.env.VITE_DINGTALK_CLIENT_ID;
  const redirectUri = `${window.location.origin}/dingtalk/callback`;

  useEffect(() => {
    if (!clientId || !qrcodeRef.current || !window.DTFrameLogin) {
      return;
    }

    qrcodeRef.current.innerHTML = "";
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
  }, [clientId, redirectUri]);

  return (
    <section>
      <h2>钉钉登录</h2>
      <p>请使用钉钉 App 扫码登录。</p>
      {!clientId ? <p>未配置 VITE_DINGTALK_CLIENT_ID，无法展示二维码。</p> : null}
      <div id="dingtalk-qrcode" ref={qrcodeRef} />
      {error ? <p>{error}</p> : null}
    </section>
  );
}
