const { prisma } = require("../repositories/prisma");
const { buildIssueAccessWhere } = require("./issueWorkspaceScope");
const { mapIssueToApi } = require("../utils/issueDto");

async function queryIssues({
  organizationId,
  workspaceId = null,
  status,
  teamId,
  assigneeId,
  page = 1,
  pageSize = 20
}) {
  const baseWhere =
    workspaceId == null ? { organizationId } : buildIssueAccessWhere(organizationId, workspaceId);

  const where = {
    ...baseWhere,
    parentIssueId: null,
    ...(status ? { status } : {}),
    ...(teamId ? { teamId } : {}),
    ...(assigneeId ? { assigneeId } : {})
  };

  const normalizedPage = Number(page) || 1;
  const normalizedPageSize = Number(pageSize) || 20;

  const [rows, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize
    }),
    prisma.issue.count({ where })
  ]);

  return {
    items: rows.map((r) => mapIssueToApi(r)),
    pageInfo: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total
    }
  };
}

async function boardIssuesByStatus(organizationId, workspaceId = null) {
  const baseWhere =
    workspaceId == null
      ? { organizationId, parentIssueId: null }
      : { ...buildIssueAccessWhere(organizationId, workspaceId), parentIssueId: null };

  const rows = await prisma.issue.findMany({ where: baseWhere, orderBy: { updatedAt: "desc" } });

  return rows.reduce(
    (acc, issue) => {
      const key = issue.status;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(mapIssueToApi(issue));
      return acc;
    },
    { todo: [], in_progress: [], in_review: [], done: [] }
  );
}

module.exports = { queryIssues, boardIssuesByStatus };
