const { prisma } = require("../repositories/prisma");
const { issueAllowedForWorkspaceContext } = require("./issueWorkspaceScope");
const { isIssuesIdUrlParam } = require("../utils/issuesId");

async function findIssueByRouteParam(raw, context) {
  const { workspaceId, userId, organizationId } = context;
  let row = null;

  if (workspaceId && isIssuesIdUrlParam(raw)) {
    row = await prisma.issue.findFirst({
      where: { workspaceId, issuesId: raw.trim().toUpperCase() }
    });
  }

  if (!row && isIssuesIdUrlParam(raw) && userId) {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, organizationId: true } } }
    });
    const wids = [
      ...new Set(
        memberships
          .filter((m) => m.workspace && (!organizationId || m.workspace.organizationId === organizationId))
          .map((m) => m.workspaceId)
      )
    ];
    if (wids.length) {
      row = await prisma.issue.findFirst({
        where: { issuesId: raw.trim().toUpperCase(), workspaceId: { in: wids } }
      });
    }
  }

  if (!row) {
    row = await prisma.issue.findUnique({ where: { id: raw } });
  }
  if (!row) {
    return null;
  }

  if (organizationId && row.organizationId !== organizationId) {
    return null;
  }

  const inSelectedWorkspace =
    workspaceId && (await issueAllowedForWorkspaceContext(row, context));
  const userMembership =
    userId &&
    (await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: row.workspaceId }
    }));

  if (!inSelectedWorkspace && !userMembership) {
    return null;
  }
  return row;
}

module.exports = { findIssueByRouteParam };
