/**
 * 稳定展示与路由：`PREFIX-NUMBER`（大写前缀）
 */
function buildIssuesId(identifierRaw, issueNumber) {
  const prefix = String(identifierRaw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const base = prefix || "X";
  return `${base}-${issueNumber}`;
}

function isIssuesIdUrlParam(param) {
  if (!param || typeof param !== "string") return false;
  return /^[A-Za-z][A-Za-z0-9_-]*-\d+$/.test(param);
}

module.exports = { buildIssuesId, isIssuesIdUrlParam };
