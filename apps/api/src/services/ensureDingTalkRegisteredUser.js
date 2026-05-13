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
  const userIdForAt = identity.dingTalkUserId || null;

  const displayName = identity.name ?? email.split("@")[0];

  // 防并发：优先按 unionId 命中；否则按 email upsert；如遇唯一约束冲突则回退查询
  try {
    if (unionId) {
      const hit = await client.user.findUnique({ where: { dingTalkUnionId: unionId } });
      if (hit) {
        const data = {
          name: identity.name ?? hit.name,
          ...(identity.picture !== undefined ? { avatarUrl: identity.picture ?? hit.avatarUrl } : {}),
          ...(staffId ? { dingTalkStaffId: staffId } : {}),
          ...(userIdForAt ? { dingTalkUserId: userIdForAt } : {}),
          ...(identity.dingTalkMobile !== undefined && identity.dingTalkMobile !== null
            ? { dingTalkMobile: identity.dingTalkMobile }
            : {})
        };
        return client.user.update({ where: { id: hit.id }, data });
      }
    }

    const upserted = await client.user.upsert({
      where: { email },
      create: {
        email,
        name: displayName,
        avatarUrl: identity.picture ?? null,
        ...(unionId ? { dingTalkUnionId: unionId } : {}),
        ...(staffId ? { dingTalkStaffId: staffId } : {}),
        ...(userIdForAt ? { dingTalkUserId: userIdForAt } : {}),
        ...(identity.dingTalkMobile !== undefined && identity.dingTalkMobile !== null
          ? { dingTalkMobile: identity.dingTalkMobile }
          : {})
      },
      update: {
        name: identity.name ?? undefined,
        ...(identity.picture !== undefined ? { avatarUrl: identity.picture ?? undefined } : {}),
        ...(unionId ? { dingTalkUnionId: unionId } : {}),
        ...(staffId ? { dingTalkStaffId: staffId } : {}),
        ...(userIdForAt ? { dingTalkUserId: userIdForAt } : {}),
        ...(identity.dingTalkMobile !== undefined && identity.dingTalkMobile !== null
          ? { dingTalkMobile: identity.dingTalkMobile }
          : {})
      }
    });
    return upserted;
  } catch (e) {
    // 典型场景：并发创建导致 email/unionId 唯一约束冲突；回退查找返回已有用户
    if (unionId) {
      const hit = await client.user.findUnique({ where: { dingTalkUnionId: unionId } });
      if (hit) {
        return hit;
      }
    }
    const byEmail = await client.user.findUnique({ where: { email } });
    if (byEmail) {
      return byEmail;
    }
    throw e;
  }
}

module.exports = { ensureUserFromLoginIdentity };
