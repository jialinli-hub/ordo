const { store } = require("../repositories/memoryStore");

function queryIssues({ organizationId, status, page = 1, pageSize = 20 }) {
  let items = store.issues.filter((issue) => issue.organizationId === organizationId);
  if (status) {
    items = items.filter((issue) => issue.status === status);
  }

  const normalizedPage = Number(page) || 1;
  const normalizedPageSize = Number(pageSize) || 20;
  const start = (normalizedPage - 1) * normalizedPageSize;
  const pagedItems = items.slice(start, start + normalizedPageSize);

  return {
    items: pagedItems,
    pageInfo: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total: items.length
    }
  };
}

function boardIssuesByStatus(organizationId) {
  const items = store.issues.filter((issue) => issue.organizationId === organizationId);
  return items.reduce(
    (acc, issue) => {
      const key = issue.status;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(issue);
      return acc;
    },
    { todo: [], in_progress: [], in_review: [], done: [] }
  );
}

module.exports = { queryIssues, boardIssuesByStatus };
