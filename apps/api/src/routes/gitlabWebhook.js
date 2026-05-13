const express = require("express");

const { prisma } = require("../repositories/prisma");

const { invalidateWorkspace } = require("../services/workspaceReadCache");

const {

  uniq,

  normalizeGitlabTrigger,

  pickTargetBranch,

  selectRulesForBranch,

  computeNextStatus,

  buildGitlabActivityPayload,

  collectSourcesFromPayload,

  extractIssuesIdsFromText,

  buildDeliverySummary

} = require("../services/gitlabWebhookShared");



const gitlabWebhookRouter = express.Router();



function pickHeader(req, key) {

  const v = req.headers[String(key).toLowerCase()];

  return v == null ? "" : String(v);

}



async function appendActivity(prismaClient, issueId, type, userId, payload = {}) {

  await prismaClient.issueActivity.create({

    data: {

      issueId,

      type,

      userId: userId || null,

      payload: payload && typeof payload === "object" ? payload : {}

    }

  });

}



function getTeamGitlabConfig(team) {

  const w = team?.workflowAutomationsJson && typeof team.workflowAutomationsJson === "object"

    ? team.workflowAutomationsJson

    : null;

  return w?.gitlab && typeof w.gitlab === "object" ? w.gitlab : null;

}



/**

 * @param {import("@prisma/client").Prisma.TransactionClient} tx

 * @param {{ workspaceId: string, payload: object, gitlabEvent: string, teamScoped?: { teamId: string } }} ctx

 */

async function applyGitlabWebhookInTx(tx, ctx) {

  const { workspaceId, payload, gitlabEvent, teamScoped } = ctx;

  const kind = payload?.object_kind || payload?.event_type || "";

  const trigger = normalizeGitlabTrigger(payload, gitlabEvent);

  if (!trigger) {

    return { skipped: "unsupported_event" };

  }



  const targetBranch = pickTargetBranch(payload);

  const sources = collectSourcesFromPayload(payload);

  const issueIds = uniq(sources.flatMap(extractIssuesIdsFromText)).slice(0, 20);



  if (!issueIds.length) {

    await tx.gitlabWebhookDelivery.create({

      data: {

        workspaceId,

        gitlabEventHeader: gitlabEvent || null,

        objectKind: kind || null,

        summary: buildDeliverySummary(payload, []),

        matchedIssueKeys: [],

        detail: { skipped: "no_issue_id", trigger }

      }

    });

    return { skipped: "no_issue_id", trigger, matchedKeys: [], updated: [] };

  }



  const activityPayload = buildGitlabActivityPayload(payload, gitlabEvent);

  /** @type {{ row: object, team: object | null, gl: object | null, desiredStatus: string | null }[]} */

  const planned = [];



  for (const issuesId of issueIds) {

    const row = await tx.issue.findFirst({

      where: teamScoped

        ? { workspaceId, teamId: teamScoped.teamId, issuesId }

        : { workspaceId, issuesId }

    });

    if (!row) {

      continue;

    }

    let team = null;

    if (row.teamId) {

      team = await tx.team.findUnique({ where: { id: row.teamId } });

    }

    const gl = getTeamGitlabConfig(team);

    const rules = selectRulesForBranch(gl?.rules, gl?.branchRules, targetBranch);

    const ruleTarget = rules?.[trigger] ? String(rules[trigger]) : null;

    const automationAllowed = Boolean(gl?.enabled);

    planned.push({

      row,

      team,

      gl,

      desiredStatus: automationAllowed && ruleTarget ? ruleTarget : null

    });

  }



  const matchedKeys = planned.map((p) => p.row.issuesId);

  const extractedNotMatched = issueIds.filter((id) => !matchedKeys.includes(id));

  const deliveryDetail = {

    kind,

    targetBranch,

    trigger,

    activityPreview: activityPayload,

    matchedCount: planned.length,

    extractedIssueKeys: issueIds,

    extractedNotMatched

  };



  if (!planned.length) {

    await tx.gitlabWebhookDelivery.create({

      data: {

        workspaceId,

        gitlabEventHeader: gitlabEvent || null,

        objectKind: kind || null,

        summary: buildDeliverySummary(payload, issueIds),

        matchedIssueKeys: [],

        detail: { ...deliveryDetail, skipped: "no_matching_issues_in_workspace" }

      }

    });

    return {

      skipped: "no_matching_issues",

      trigger,

      matchedKeys: [],

      updated: [],

      issueIds,

      extractedNotMatched

    };

  }



  const updated = [];

  for (const item of planned) {

    await appendActivity(tx, item.row.id, "gitlab_event", null, activityPayload);



    const desired = item.desiredStatus;

    if (!desired) {

      continue;

    }



    let cur = item.row.status;

    for (let i = 0; i < 5 && cur !== desired; i += 1) {

      const next = computeNextStatus(cur, desired);

      if (!next) {

        break;

      }

      cur = next;

    }

    if (cur === item.row.status) {

      continue;

    }

    const nextRow = await tx.issue.update({

      where: { id: item.row.id },

      data: { status: cur, updatedAt: new Date() }

    });

    await appendActivity(tx, item.row.id, "workflow_automation", null, {

      provider: "gitlab",

      trigger,

      desiredStatus: desired,

      appliedStatus: cur,

      issuesId: item.row.issuesId,

      targetBranch,

      gitlabEvent,

      kind,

      webUrl: payload?.object_attributes?.url || null

    });

    updated.push({ id: nextRow.id, issuesId: nextRow.issuesId, status: nextRow.status });

  }



  await tx.gitlabWebhookDelivery.create({

    data: {

      workspaceId,

      gitlabEventHeader: gitlabEvent || null,

      objectKind: kind || null,

      summary: buildDeliverySummary(payload, matchedKeys),

      matchedIssueKeys: matchedKeys,

      detail: deliveryDetail

    }

  });



  return {

    trigger,

    targetBranch,

    matchedKeys,

    updated,

    deliveryDetail

  };

}



/** GitLab Webhook (per-team) */

gitlabWebhookRouter.post("/integrations/gitlab/webhook/:teamId", async (req, res) => {

  const { teamId } = req.params;

  const token = pickHeader(req, "x-gitlab-token");

  const gitlabEvent = pickHeader(req, "x-gitlab-event");

  const payload = req.body || {};



  const team = await prisma.team.findUnique({ where: { id: teamId } });

  if (!team) {

    return res.status(404).json({ message: "team not found" });

  }



  const cfg = team.workflowAutomationsJson && typeof team.workflowAutomationsJson === "object"

    ? team.workflowAutomationsJson

    : null;

  const gl = cfg?.gitlab;

  if (!gl?.enabled) {

    return res.status(202).json({ ok: true, skipped: "disabled" });

  }

  const secret = String(gl.secret || "");

  if (!secret || token !== secret) {

    return res.status(401).json({ message: "invalid webhook token" });

  }



  const trigger = normalizeGitlabTrigger(payload, gitlabEvent);

  if (!trigger) {

    return res.status(202).json({ ok: true, skipped: "unsupported_event" });

  }



  const targetBranch = pickTargetBranch(payload);

  const rules = selectRulesForBranch(gl.rules, gl.branchRules, targetBranch);

  const desiredStatus = rules?.[trigger] ? String(rules[trigger]) : null;



  let result;

  try {

    result = await prisma.$transaction(async (tx) =>

      applyGitlabWebhookInTx(tx, {

        workspaceId: team.workspaceId,

        payload,

        gitlabEvent,

        teamScoped: { teamId: team.id }

      })

    );

  } catch (e) {

    console.error("[gitlab webhook team]", e);

    return res.status(500).json({ message: "webhook processing failed" });

  }



  invalidateWorkspace(team.workspaceId);



  if (result.skipped) {

    return res.status(202).json({

      ok: true,

      skipped: result.skipped,

      trigger: result.trigger,

      desiredStatus,

      targetBranch

    });

  }



  const updatedCount = result.updated?.length ?? 0;



  return res.json({

    ok: true,

    trigger: result.trigger,

    targetBranch: result.targetBranch,

    desiredStatus,

    updatedCount,

    updated: result.updated,

    matchedIssueKeys: result.matchedKeys

  });

});



/** 工作区统一 Webhook URL，密钥在 Workspace 设置中配置 */

gitlabWebhookRouter.post("/integrations/gitlab/webhook/workspace/:workspaceId", async (req, res) => {

  const { workspaceId } = req.params;

  const token = pickHeader(req, "x-gitlab-token");

  const gitlabEvent = pickHeader(req, "x-gitlab-event");

  const payload = req.body || {};



  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });

  if (!workspace) {

    return res.status(404).json({ message: "workspace not found" });

  }



  const gij =

    workspace.gitlabIntegrationJson && typeof workspace.gitlabIntegrationJson === "object"

      ? workspace.gitlabIntegrationJson

      : {};

  if (!gij.enabled) {

    return res.status(202).json({ ok: true, skipped: "workspace_gitlab_disabled" });

  }

  const wsecret = String(gij.secret || "").trim();

  if (!wsecret || token !== wsecret) {

    return res.status(401).json({ message: "invalid webhook token" });

  }



  const triggerProbe = normalizeGitlabTrigger(payload, gitlabEvent);

  if (!triggerProbe) {

    await prisma.gitlabWebhookDelivery.create({

      data: {

        workspaceId: workspace.id,

        gitlabEventHeader: gitlabEvent || null,

        objectKind: payload?.object_kind || null,

        summary: buildDeliverySummary(payload, []),

        matchedIssueKeys: [],

        detail: { skipped: "unsupported_event" }

      }

    });

    invalidateWorkspace(workspace.id);

    return res.status(202).json({ ok: true, skipped: "unsupported_event" });

  }



  let result;

  try {

    result = await prisma.$transaction(async (tx) =>

      applyGitlabWebhookInTx(tx, {

        workspaceId: workspace.id,

        payload,

        gitlabEvent,

        teamScoped: undefined

      })

    );

  } catch (e) {

    console.error("[gitlab webhook workspace]", e);

    return res.status(500).json({ message: "webhook processing failed" });

  }



  invalidateWorkspace(workspace.id);



  if (result.skipped) {

    return res.status(202).json({

      ok: true,

      skipped: result.skipped,

      trigger: result.trigger,

      targetBranch: result.targetBranch,

      matchedIssueKeys: result.matchedKeys ?? []

    });

  }



  const updatedCount = result.updated?.length ?? 0;



  return res.json({

    ok: true,

    trigger: result.trigger,

    targetBranch: result.targetBranch,

    updatedCount,

    updated: result.updated,

    matchedIssueKeys: result.matchedKeys

  });

});



module.exports = { gitlabWebhookRouter };

