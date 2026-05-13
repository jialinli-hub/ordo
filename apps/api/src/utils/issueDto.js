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
  {
    includeComments = false,
    includeActivity = false,
    includeSubtasks = false,
    includeParent = false,
    includeAttachments = false
  } = {}
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

  let subtasks =
    row.subtasks?.map((s) => mapIssueToApi(s, { includeSubtasks: false, includeParent: false })) ??
    undefined;

  let parent =
    row.parent != null
      ? {
          id: row.parent.id,
          title: row.parent.title,
          issues_id:
            row.parent.issuesId != null && row.parent.issuesId !== ""
              ? row.parent.issuesId
              : row.parent.id
        }
      : undefined;

  let attachments;
  if (includeAttachments) {
    attachments = (row.attachments || []).map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      size: a.size,
      uploadedById: a.uploadedById,
      createdAt: iso(a.createdAt)
    }));
  }

  if (!includeComments) {
    comments = undefined;
  }
  if (!includeActivity) {
    activity = undefined;
  }
  if (!includeSubtasks) {
    subtasks = undefined;
  }
  if (!includeParent) {
    parent = undefined;
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
    parentIssueId: row.parentIssueId ?? null,
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
    ...(activity !== undefined ? { activity } : {}),
    ...(subtasks !== undefined ? { subtasks } : {}),
    ...(parent !== undefined ? { parent } : {}),
    ...(includeAttachments ? { attachments } : {})
  };
}

module.exports = { mapIssueToApi };
