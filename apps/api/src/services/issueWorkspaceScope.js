const { prisma } = require("../repositories/prisma");

async function getTeamWorkspaceId(teamId) {
  if (!teamId) {
    return null;
  }
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { workspaceId: true } });
  return team?.workspaceId ?? null;
}

async function issueAllowedForWorkspaceContext(issue, context) {
  if (!issue || issue.organizationId !== context.organizationId) {
    return false;
  }
  const ws = context.workspaceId;
  if (issue.workspaceId === ws) {
    return true;
  }
  const teamWs = await getTeamWorkspaceId(issue.teamId);
  return teamWs === ws;
}

function buildIssueAccessWhere(organizationId, workspaceId) {
  return {
    organizationId,
    OR: [{ workspaceId }, { AND: [{ teamId: { not: null } }, { team: { workspaceId } }] }]
  };
}

module.exports = { issueAllowedForWorkspaceContext, getTeamWorkspaceId, buildIssueAccessWhere };
