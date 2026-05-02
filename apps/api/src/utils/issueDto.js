function iso(d) {
  if (d == null) {
    return null;
  }
  if (d instanceof Date) {
    return d.toISOString();
  }
  return d;
}

function mapIssueToApi(
  row,
  { includeComments = false, includeActivity = false } = {}
) {
  if (!row) {
    return null;
  }

  let comments =
    row.comments?.map((c) => ({
      id: c.id,
      issueId: c.issueId,
      body: c.body,
      userId: c.userId,
      createdAt: iso(c.createdAt)
    })) ?? undefined;

  let activity =
    row.activities?.map((a) => ({
      id: a.id,
      type: a.type,
      userId: a.userId,
      payload: a.payload && typeof a.payload === "object" ? a.payload : {},
      createdAt: iso(a.createdAt)
    })) ?? undefined;

  if (!includeComments) {
    comments = undefined;
  }
  if (!includeActivity) {
    activity = undefined;
  }

  const identifier = row.displayIdentifier ?? null;
  const issueNumber = row.issueNumber;
  const issues_id =
    row.issuesId != null && row.issuesId !== ""
      ? row.issuesId
      : identifier != null && issueNumber != null
        ? `${String(identifier).toUpperCase()}-${issueNumber}`
        : row.id;

  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    projectId: row.projectId,
    cycleId: row.cycleId,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    priority: row.priority,
    type: row.type,
    estimateHours: row.estimateHours ?? null,
    assigneeId: row.assigneeId ?? null,
    labels: Array.isArray(row.labels) ? row.labels : [],
    dueDate: iso(row.dueDate),
    identifier,
    /** 展示与路由：`PREFIX-NUMBER` */
    issues_id,
    issueNumber: row.issueNumber,
    numberScope: row.numberScope,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(comments !== undefined ? { comments } : {}),
    ...(activity !== undefined ? { activity } : {})
  };
}

module.exports = { mapIssueToApi };
