const { store } = require("../repositories/memoryStore");

function getNextIssueNumber(projectId) {
  const current = store.projectIssueCounters[projectId] ?? 0;
  const next = current + 1;
  store.projectIssueCounters[projectId] = next;
  return next;
}

module.exports = { getNextIssueNumber };
