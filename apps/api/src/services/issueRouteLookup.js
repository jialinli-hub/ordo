const { prisma } = require("../repositories/prisma");
const { issueAllowedForWorkspaceContext } = require("./issueWorkspaceScope");
const { isIssuesIdUrlParam } = require("../utils/issuesId");

async function findIssueByRouteParam(raw, context) {
  const { workspaceId } = context;
  let row = null;
  if (isIssuesIdUrlParam(raw)) {
    row = await prisma.issue.findFirst({
      where: { workspaceId, issuesId: raw.trim().toUpperCase() }
    });
  }
  if (!row) {
    row = await prisma.issue.findUnique({ where: { id: raw } });
  }
  if (!row) {
    return null;
  }
  if (!(await issueAllowedForWorkspaceContext(row, context))) {
    return null;
  }
  return row;
}

module.exports = { findIssueByRouteParam };
