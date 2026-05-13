function parseDevIdentity(idToken) {
  if (!idToken || !idToken.startsWith("dev-dingtalk:")) {
    return null;
  }

  const email = idToken.slice("dev-dingtalk:".length);
  return {
    email,
    name: email.split("@")[0],
    picture: null
  };
}

async function parseDingTalkAccessToken(accessToken) {
  const response = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
    method: "GET",
    headers: {
      "x-acs-dingtalk-access-token": accessToken
    }
  });
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  console.log("[dingtalk] contact/users/me 响应体", data);
  const union =
    data?.unionId != null && data.unionId !== ""
      ? String(data.unionId)
      : data?.unionid != null && data.unionid !== ""
        ? String(data.unionid)
        : "";

  if (!union && !data?.mobile && data?.staffId == null && data?.staff_id == null) {
    return null;
  }

  const primary = data.email != null ? String(data.email).trim() : "";
  const email =
    primary ||
    `${data.staffId ?? data.staff_id ?? (union || data.mobile || "dingtalk-user")}@dingtalk.local`;

  const mobileRaw = data.mobile ?? data.mobilePhone ?? data.telephone ?? data.phone ?? "";
  const dingTalkMobile =
    mobileRaw != null && String(mobileRaw).trim() !== "" ? String(mobileRaw).trim() : undefined;

  /** 群机器人 text.at.atUserIds 须使用企业内部 userid；见开放平台「自定义机器人发送群消息」 */
  const rawUid = data.userId ?? data.userid ?? data.user_id;
  const dingTalkUserId =
    rawUid != null && String(rawUid).trim() !== "" ? String(rawUid).trim() : undefined;

  return {
    email,
    name: data.nick || data.name || email.split("@")[0],
    picture: data.avatarUrl || null,
    dingTalkUnionId: union || null,
    dingTalkStaffId: data.staffId != null ? String(data.staffId) : data.staff_id != null ? String(data.staff_id) : null,
    dingTalkUserId,
    dingTalkMobile
  };
}

async function resolveIdentityFromIdToken(idToken) {
  const devIdentity = parseDevIdentity(idToken);
  if (devIdentity) {
    return devIdentity;
  }

  try {
    return await parseDingTalkAccessToken(idToken);
  } catch {
    return null;
  }
}

module.exports = { resolveIdentityFromIdToken };
