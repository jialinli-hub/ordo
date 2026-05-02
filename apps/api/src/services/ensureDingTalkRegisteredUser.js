const { prisma } = require("../repositories/prisma");

/**
 * 登录即注册：根据钉钉 unionId（优先）或邮箱匹配用户，不存在则静默创建，
 * 已存在则补齐/更新钉钉侧标识与展示信息。
 */
async function ensureUserFromLoginIdentity(identity, client = prisma) {
  if (!identity) {
    return null;
  }
  const emailRaw = identity.email;
  if (emailRaw == null || String(emailRaw).trim() === "") {
    return null;
  }
  const email = String(emailRaw).trim();
  const unionId = identity.dingTalkUnionId || null;
  const staffId = identity.dingTalkStaffId || null;

  let user = null;
  if (unionId) {
    user = await client.user.findUnique({ where: { dingTalkUnionId: unionId } });
  }
  if (!user) {
    user = await client.user.findUnique({ where: { email } });
  }

  const displayName = identity.name ?? email.split("@")[0];

  if (!user) {
    return client.user.create({
      data: {
        email,
        name: displayName,
        avatarUrl: identity.picture ?? null,
        ...(unionId ? { dingTalkUnionId: unionId } : {}),
        ...(staffId ? { dingTalkStaffId: staffId } : {})
      }
    });
  }

  const data = {
    name: identity.name ?? user.name
  };
  if (identity.picture !== undefined) {
    data.avatarUrl = identity.picture ?? user.avatarUrl;
  }
  if (unionId) {
    data.dingTalkUnionId = unionId;
  }
  if (staffId) {
    data.dingTalkStaffId = staffId;
  }

  return client.user.update({
    where: { id: user.id },
    data
  });
}

module.exports = { ensureUserFromLoginIdentity };
