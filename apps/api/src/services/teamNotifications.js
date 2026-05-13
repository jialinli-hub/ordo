const { prisma } = require("../repositories/prisma");
const { sendDingTalkBotText } = require("./dingtalkBotClient");

/** 钉钉机器人关键词 / 首行固定标记（群内设了「关键词」安全时需包含） */
const DINGTALK_ORDO_MARK = "Ordo";

/** 日志里脱敏 webhook，避免泄露完整 query */
function maskWebhookForLog(url) {
  const s = String(url || "").trim();
  if (!s) {
    return "";
  }
  try {
    const u = new URL(s);
    const path = u.pathname.length > 36 ? `${u.pathname.slice(0, 32)}…` : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return "(invalid url)";
  }
}

function maskMobileForLog(m) {
  const s = String(m || "").trim();
  if (!s) return "";
  if (s.length < 8) return "**";
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function maskUserIdForLog(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  if (s.length <= 6) return "****";
  return `${s.slice(0, 2)}…${s.slice(-4)}`;
}

function prependOrdo(body) {
  const b = String(body ?? "").trim();
  return b ? `${DINGTALK_ORDO_MARK}\n\n${b}` : DINGTALK_ORDO_MARK;
}

function getDingTalkConfig(team) {
  const raw = team?.notificationSettingsJson;
  const obj = raw && typeof raw === "object" ? raw : null;
  const dt = obj?.dingtalk;
  if (!dt || typeof dt !== "object") {
    return { enabled: false };
  }
  return {
    enabled: Boolean(dt.enabled),
    botWebhookUrl: String(dt.botWebhookUrl || "").trim(),
    botSecret: String(dt.botSecret || "").trim()
  };
}

async function resolveNotifyTeams({ workspaceId, teamId }) {
  if (teamId) {
    const one = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
    return one ? [one] : [];
  }
  return prisma.team.findMany({ where: { workspaceId } });
}

async function notifyTeamsDingTalk({ workspaceId, teamId = null, text, atMobiles, atUserIds }) {
  const teams = await resolveNotifyTeams({ workspaceId, teamId });
  const payloadText = text == null ? "" : String(text);
  const atList = Array.isArray(atMobiles) ? atMobiles.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const atUidList = Array.isArray(atUserIds) ? atUserIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  // eslint-disable-next-line no-console
  console.log("[notify:dingtalk] intent", {
    workspaceId,
    teamFilter: teamId ?? "(all teams)",
    teamCount: teams.length,
    text: payloadText,
    atMobiles: atList.map(maskMobileForLog),
    atUserIds: atUidList.map(maskUserIdForLog)
  });

  let sent = 0;
  for (const t of teams) {
    const cfg = getDingTalkConfig(t);
    if (!cfg.enabled) {
      // eslint-disable-next-line no-console
      console.log("[notify:dingtalk] skip", {
        teamId: t.id,
        teamName: t.name,
        reason: "notificationSettings.dingtalk.enabled 未开启"
      });
      continue;
    }
    if (!cfg.botWebhookUrl) {
      // eslint-disable-next-line no-console
      console.log("[notify:dingtalk] skip", {
        teamId: t.id,
        teamName: t.name,
        reason: "未配置 botWebhookUrl"
      });
      continue;
    }

    // eslint-disable-next-line no-console
    console.log("[notify:dingtalk] send", {
      teamId: t.id,
      teamName: t.name,
      text: payloadText,
      atMobiles: atList.map(maskMobileForLog),
      atUserIds: atUidList.map(maskUserIdForLog),
      webhook: maskWebhookForLog(cfg.botWebhookUrl),
      hasSecret: Boolean(cfg.botSecret)
    });

    await sendDingTalkBotText({
      webhookUrl: cfg.botWebhookUrl,
      secret: cfg.botSecret,
      text: payloadText,
      atMobiles: atList,
      atUserIds: atUidList
    });
    sent += 1;
  }

  if (teams.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[notify:dingtalk] skip all", { reason: "没有可通知的 Team（检查 teamId / workspace）" });
  } else if (sent === 0) {
    // eslint-disable-next-line no-console
    console.log("[notify:dingtalk] skip all", {
      reason: "所有 Team 均未启用钉钉或未填 Webhook，未发出任何消息"
    });
  }

  return { sent };
}

/** 与前端 `teamSegmentForUrl` 对齐，用于拼接任务深链 */
function slugifyPathSegment(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function teamSegmentForUrlFromTeam(team) {
  if (!team || typeof team !== "object") {
    return "";
  }
  const nameSlug = slugifyPathSegment(team.name ?? "");
  if (nameSlug.length > 0) {
    return nameSlug;
  }
  const id = team.id ? String(team.id) : "";
  if (!id) {
    return "";
  }
  return `team-${id.replace(/-/g, "").slice(0, 12)}`;
}

/**
 * 任务详情短链：`{公网根}/issues/{issuesId}`（无工作区 slug，与前端根级短链一致）。
 * @param {{ publicBase?: string, workspaceUrlSlug?: string, issuesId?: string }} p
 */
function buildIssueDeepLink(p) {
  const base = String(p?.publicBase || "").trim().replace(/\/$/, "");
  const id = String(p?.issuesId || "").trim();
  if (!base || !id) {
    return "";
  }
  const encoded = encodeURIComponent(id);
  return `${base}/issues/${encoded}`;
}

/**
 * @param {{ publicBase?: string, workspaceUrlSlug?: string, projectId?: string }} p
 */
function buildProjectDeepLink(p) {
  const base = String(p?.publicBase || "").trim().replace(/\/$/, "");
  const slug = String(p?.workspaceUrlSlug || "").trim();
  const pid = String(p?.projectId || "").trim();
  if (!base || !slug || !pid) {
    return "";
  }
  return `${base}/${slug}/projects/${encodeURIComponent(pid)}`;
}

/** 工作区项目列表（与前端默认首页路径一致） */
function buildWorkspaceHomeDeepLink(publicBase, workspaceUrlSlug) {
  const base = String(publicBase || "").trim().replace(/\/$/, "");
  const slug = String(workspaceUrlSlug || "").trim();
  if (!base || !slug) {
    return "";
  }
  return `${base}/${slug}/`;
}

/** 团队迭代列表 */
function buildCyclesListDeepLink(publicBase, workspaceUrlSlug, team) {
  const base = String(publicBase || "").trim().replace(/\/$/, "");
  const slug = String(workspaceUrlSlug || "").trim();
  const teamSeg = teamSegmentForUrlFromTeam(team);
  if (!base || !slug || !teamSeg) {
    return "";
  }
  return `${base}/${slug}/workspace/teams/${teamSeg}/cycles`;
}

function publicWebBase() {
  return String(process.env.ORDO_PUBLIC_WEB_BASE_URL || "").trim();
}

function landingOrHint(url) {
  const u = url && String(url).trim();
  return u ? `落地页：${u}` : "落地页：（未配置 ORDO_PUBLIC_WEB_BASE_URL）";
}

function normalizeIssueType(raw) {
  const t = String(raw || "").trim();
  if (t === "bug" || t === "chore" || t === "feature") {
    return t;
  }
  return "feature";
}

/** 新建 / 评论 / 完成 */
const ISSUE_ACTION_ICON = {
  created: "✨",
  commented: "💬",
  completed: "✅"
};

/** 需求 / 缺陷 / 事务（chore） */
const ISSUE_TYPE_ICON = {
  feature: "📌",
  bug: "🐛",
  chore: "📋"
};

function issueTaskHeadline(verb, issueType, issuesId) {
  const act = ISSUE_ACTION_ICON[verb] || "📌";
  const typ = ISSUE_TYPE_ICON[normalizeIssueType(issueType)] || "📌";
  const idPart = issuesId ? String(issuesId).trim() : "";
  return `${act}${typ}任务 ${idPart}`.trim();
}

/**
 * 承接人钉钉 @：优先 dingTalkUserId，其次手机号，再 staffId。
 * @returns {{ line: string, atMobiles: string[], atUserIds: string[] }}
 */
function assigneeMentionBlock(assignee, label = "承接人") {
  const atMobiles = [];
  const atUserIds = [];
  let line = `${label}：未指定`;
  if (assignee && String(assignee.name || "").trim()) {
    const nm = String(assignee.name).trim();
    const dtUid = assignee.dingTalkUserId && String(assignee.dingTalkUserId).trim();
    if (dtUid) {
      atUserIds.push(dtUid);
      line = `${label}：@${dtUid} ${nm}`;
    } else {
      const mob = assignee.dingTalkMobile ? String(assignee.dingTalkMobile).trim() : "";
      if (mob) {
        atMobiles.push(mob);
        line = `${label}：@${mob} ${nm}`;
      } else {
        const staff = assignee.dingTalkStaffId && String(assignee.dingTalkStaffId).trim();
        if (staff) {
          atUserIds.push(staff);
          line = `${label}：@${staff} ${nm}`;
        } else {
          line = `${label}：${nm}（未同步钉钉 userId / 手机号，无法 @）`;
        }
      }
    }
  }
  return { line, atMobiles, atUserIds };
}

function mergeAtTargets(a, b) {
  return {
    atMobiles: [...new Set([...(a.atMobiles || []), ...(b.atMobiles || [])])],
    atUserIds: [...new Set([...(a.atUserIds || []), ...(b.atUserIds || [])])]
  };
}

function truncateOneLine(text, maxLen) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) {
    return "（无内容）";
  }
  if (s.length <= maxLen) {
    return s;
  }
  return `${s.slice(0, maxLen - 1)}…`;
}

function formatZhDateOnly(value) {
  if (value == null) {
    return "";
  }
  const dt = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(dt.getTime())) {
    return "";
  }
  return dt.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * 新建任务（仅钉钉 text；首行 Ordo 关键词）
 */
function formatIssueNotifyCreated({
  issuesId,
  issueType,
  title,
  actor,
  assignee,
  estimateHours,
  dueDate,
  cycleName,
  projectKey,
  issueUrl
}) {
  const lines = [];
  lines.push(issueTaskHeadline("created", issueType, issuesId));
  lines.push("━━━━━━━━━━━━━━━━");
  lines.push(String(title || "").trim() || "（无标题）");

  const actorName =
    actor && String(actor.name || "").trim() ? String(actor.name).trim() : "（未知）";
  lines.push(`创建人：${actorName}`);

  const am = assigneeMentionBlock(assignee, "承接人");
  lines.push(am.line);

  const estNum = estimateHours != null && estimateHours !== "" ? Number(estimateHours) : NaN;
  lines.push(Number.isFinite(estNum) ? `预估工时：${estNum} 小时` : "预估工时：未填写");

  const dueStr = formatZhDateOnly(dueDate);
  lines.push(dueStr ? `截止时间：${dueStr}` : "截止时间：未设置");

  const cyc = cycleName && String(cycleName).trim();
  const proj = projectKey && String(projectKey).trim();
  if (cyc) {
    lines.push(`迭代：${cyc}`);
  } else if (proj) {
    lines.push(`项目：${proj}`);
  }

  lines.push(landingOrHint(issueUrl));

  return { text: prependOrdo(lines.join("\n")), atMobiles: am.atMobiles, atUserIds: am.atUserIds };
}

/**
 * 任务有新评论
 */
function formatIssueNotifyCommented({
  issuesId,
  issueType,
  title,
  commentBody,
  commenter,
  assignee,
  issueUrl
}) {
  const lines = [];
  lines.push(issueTaskHeadline("commented", issueType, issuesId));
  lines.push("━━━━━━━━━━━━━━━━");
  lines.push(String(title || "").trim() || "（无标题）");

  const cName =
    commenter && String(commenter.name || "").trim() ? String(commenter.name).trim() : "（未知）";
  lines.push(`评论人：${cName}`);
  lines.push(`评论摘要：${truncateOneLine(commentBody, 200)}`);

  const am = assigneeMentionBlock(assignee, "承接人");
  lines.push(am.line);
  lines.push(landingOrHint(issueUrl));

  return { text: prependOrdo(lines.join("\n")), atMobiles: am.atMobiles, atUserIds: am.atUserIds };
}

/**
 * 任务标记为已完成
 */
function formatIssueNotifyCompleted({
  issuesId,
  issueType,
  title,
  actor,
  assignee,
  cycleName,
  projectKey,
  issueUrl
}) {
  const lines = [];
  lines.push(issueTaskHeadline("completed", issueType, issuesId));
  lines.push("━━━━━━━━━━━━━━━━");
  lines.push(String(title || "").trim() || "（无标题）");

  const who =
    actor && String(actor.name || "").trim() ? String(actor.name).trim() : "（未知）";
  lines.push(`完成操作：${who}`);

  const am = assigneeMentionBlock(assignee, "承接人");
  lines.push(am.line);

  const cyc = cycleName && String(cycleName).trim();
  const proj = projectKey && String(projectKey).trim();
  if (cyc) {
    lines.push(`迭代：${cyc}`);
  } else if (proj) {
    lines.push(`项目：${proj}`);
  }

  lines.push(landingOrHint(issueUrl));

  return { text: prependOrdo(lines.join("\n")), atMobiles: am.atMobiles, atUserIds: am.atUserIds };
}

/**
 * 任务钉钉通知：仅 created | commented | completed
 * @returns {{ text: string, atMobiles: string[], atUserIds: string[] }}
 */
function formatIssueNotify(payload) {
  const { action, issueType: rawType } = payload;
  const issueType = normalizeIssueType(rawType);

  if (action === "created") {
    const {
      issuesId,
      title,
      actor,
      assignee,
      estimateHours,
      dueDate,
      cycleName,
      projectKey,
      projectName,
      issueUrl
    } = payload;
    return formatIssueNotifyCreated({
      issuesId,
      issueType,
      title,
      actor,
      assignee,
      estimateHours,
      dueDate,
      cycleName,
      projectKey: projectKey != null && projectKey !== "" ? projectKey : payload.projectName,
      issueUrl
    });
  }

  if (action === "commented") {
    return formatIssueNotifyCommented({
      issuesId: payload.issuesId,
      issueType,
      title: payload.title,
      commentBody: payload.commentBody,
      commenter: payload.commenter,
      assignee: payload.assignee,
      issueUrl: payload.issueUrl
    });
  }

  if (action === "completed") {
    const { issuesId, title, actor, assignee, cycleName, projectKey, projectName, issueUrl } = payload;
    return formatIssueNotifyCompleted({
      issuesId,
      issueType,
      title,
      actor,
      assignee,
      cycleName,
      projectKey: projectKey != null && projectKey !== "" ? projectKey : projectName,
      issueUrl
    });
  }

  throw new Error(`formatIssueNotify: unsupported action ${String(action)}`);
}

/** 迭代创建（仅创建场景调用） */
function formatCycleNotifyCreated({ name, startsAt, endsAt, status, projectKey, landingUrl }) {
  const lines = [];
  lines.push(`🔄 新建迭代${name ? ` ${name}` : ""}`.trim());
  lines.push("━━━━━━━━━━━━━━━━");
  const range =
    startsAt && endsAt ? `周期：${String(startsAt).slice(0, 10)} ～ ${String(endsAt).slice(0, 10)}` : null;
  if (range) {
    lines.push(range);
  }
  if (status) {
    lines.push(`状态：${status}`);
  }
  const pk = projectKey && String(projectKey).trim();
  if (pk) {
    lines.push(`关联项目：${pk}`);
  }
  lines.push(landingOrHint(landingUrl));
  return prependOrdo(lines.join("\n"));
}

/** 项目创建 / 删除 */
function formatProjectNotify({ action, name, key, landingUrl }) {
  const lines = [];
  if (action === "created") {
    lines.push(`📁 新建项目${name ? ` ${name}` : ""}`.trim());
  } else if (action === "deleted") {
    lines.push(`🗑️ 已删除项目${name ? ` ${name}` : ""}`.trim());
  } else {
    throw new Error(`formatProjectNotify: unsupported action ${String(action)}`);
  }
  lines.push("━━━━━━━━━━━━━━━━");
  const k = key && String(key).trim();
  if (k) {
    lines.push(`标识：${k}`);
  }
  lines.push(landingOrHint(landingUrl));
  return prependOrdo(lines.join("\n"));
}

module.exports = {
  notifyTeamsDingTalk,
  formatIssueNotify,
  formatCycleNotifyCreated,
  formatProjectNotify,
  buildIssueDeepLink,
  buildProjectDeepLink,
  buildWorkspaceHomeDeepLink,
  buildCyclesListDeepLink,
  publicWebBase
};

