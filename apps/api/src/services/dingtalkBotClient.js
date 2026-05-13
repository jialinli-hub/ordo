const crypto = require("node:crypto");

function normalizeMobiles(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((x) => String(x || "").trim()).filter(Boolean);
}

function normalizeUserIds(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((x) => String(x || "").trim()).filter(Boolean);
}

/** 日志用：保留 path，脱敏 access_token / sign */
function describeRequestUrlForLog(fullUrl) {
  try {
    const u = new URL(String(fullUrl));
    const tok = u.searchParams.get("access_token");
    if (tok) {
      u.searchParams.set("access_token", tok.length > 10 ? `${tok.slice(0, 4)}…${tok.slice(-4)}` : "(short)");
    }
    const sign = u.searchParams.get("sign");
    if (sign) {
      u.searchParams.set("sign", `${sign.slice(0, 8)}…`);
    }
    return u.toString();
  } catch {
    return "(invalid url)";
  }
}

function buildSignedUrl(webhookUrl, secret) {
  const url = new URL(String(webhookUrl));
  const sec = String(secret || "").trim();
  if (!sec) {
    return url.toString();
  }
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${sec}`;
  const signData = crypto.createHmac("sha256", sec).update(stringToSign).digest("base64");
  url.searchParams.set("timestamp", String(timestamp));
  // URLSearchParams 会自动做 URL 编码；不要重复 encode，否则会双重编码导致验签失败。
  url.searchParams.set("sign", signData);
  return url.toString();
}

async function sendDingTalkBotText({ webhookUrl, secret, text, atMobiles = [], atUserIds = [] }) {
  const hook = String(webhookUrl || "").trim();
  if (!hook) {
    throw new Error("DingTalk webhookUrl is required");
  }
  const sec = String(secret || "").trim();
  const mobiles = normalizeMobiles(atMobiles);
  const userIds = normalizeUserIds(atUserIds);
  /** @type {{ atMobiles: string[]; atUserIds: string[]; isAtAll: boolean }} */
  const atBlock = { atMobiles: mobiles, atUserIds: userIds, isAtAll: false };
  const body = {
    msgtype: "text",
    text: { content: String(text || "") },
    at: atBlock
  };
  const url = buildSignedUrl(hook, sec);
  const signingApplied = Boolean(sec);

  // eslint-disable-next-line no-console
  console.log("[notify:dingtalk] request body (与 POST JSON 一致)", JSON.stringify(body));
  // eslint-disable-next-line no-console
  console.log("[notify:dingtalk] request meta", {
    signingApplied,
    url: describeRequestUrlForLog(url),
    hasTimestampParam: signingApplied
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    // ignore
  }

  const errcode = data && typeof data.errcode !== "undefined" ? Number(data.errcode) : null;
  const errmsg = data && data.errmsg != null ? String(data.errmsg) : "";
  // eslint-disable-next-line no-console
  console.log("[notify:dingtalk] response", {
    httpStatus: res.status,
    errcode,
    errmsg: errmsg || undefined,
    raw: raw.length > 500 ? `${raw.slice(0, 500)}…` : raw
  });

  if (!res.ok) {
    throw new Error(`DingTalk bot request failed: ${res.status} ${raw}`);
  }
  // errcode=0 means ok for DingTalk robot API
  if (data && typeof data.errcode !== "undefined" && Number(data.errcode) !== 0) {
    if (/关键词/u.test(errmsg)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[notify:dingtalk] 钉钉提示关键词：若在开放平台将安全设置改为「加签」后仍报错，请核对团队设置里已填写与机器人一致的 SECRET，且 Webhook 对应该机器人；加签通过时正文不必含自定义关键词。"
      );
    }
    throw new Error(data.errmsg || "DingTalk bot request failed");
  }
  return data || { ok: true };
}

module.exports = { sendDingTalkBotText };

