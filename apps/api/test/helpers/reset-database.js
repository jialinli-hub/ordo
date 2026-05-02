const { prisma } = require("../../src/repositories/prisma");

async function resetDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未设置（测试需要可用的 PostgreSQL 连接字符串）");
  }
  await prisma.$executeRawUnsafe(`
TRUNCATE TABLE
  "IssueActivity",
  "IssueComment",
  "Issue",
  "UserPreference",
  "IssueNumberCounter",
  "Cycle",
  "Project",
  "Team",
  "WorkspaceInvite",
  "WorkspaceMember",
  "Workspace",
  "User",
  "Organization"
RESTART IDENTITY CASCADE;
`);
}

module.exports = { resetDatabase };
