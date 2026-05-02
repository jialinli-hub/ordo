const { prisma } = require("../repositories/prisma");

/**
 * 在事务内占用下一个 issue 序号（与 `Issue.create` 同事务，避免双事务竞态）
 * @param {object} tx Prisma 事务 client
 */
async function bumpIssueNumberCounter(tx, workspaceId, scopeKey) {
  const row = await tx.issueNumberCounter.upsert({
    where: {
      workspaceId_scopeKey: { workspaceId, scopeKey }
    },
    update: { current: { increment: 1 } },
    create: { workspaceId, scopeKey, current: 1 }
  });
  const n = row.current;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`invalid issue counter value: ${String(n)}`);
  }
  return n;
}

async function getNextIssueNumber(workspaceId, scopeKey) {
  return prisma.$transaction(async (tx) => bumpIssueNumberCounter(tx, workspaceId, scopeKey));
}

module.exports = { getNextIssueNumber, bumpIssueNumberCounter };
