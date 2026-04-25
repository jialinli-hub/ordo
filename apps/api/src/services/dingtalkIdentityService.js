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
  if (!data?.unionId && !data?.mobile && !data?.staffId) {
    return null;
  }

  const email =
    data.email ||
    `${data.staffId || data.unionId || data.mobile || "user"}@dingtalk.local`;

  return {
    email,
    name: data.nick || data.name || email.split("@")[0],
    picture: data.avatarUrl || null
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
