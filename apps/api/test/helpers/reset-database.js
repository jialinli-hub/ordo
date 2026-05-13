const { prisma } = require("../../src/repositories/prisma");

async function resetDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未设置（测试需要可用的 PostgreSQL 连接字符串）");
  }
  await prisma.$executeRawUnsafe(`
DO $$
BEGIN
  IF to_regclass('public."Requirement"') IS NOT NULL THEN
    TRUNCATE TABLE "Requirement" RESTART IDENTITY CASCADE;
  END IF;
END $$;
`);
  await prisma.$executeRawUnsafe(`
TRUNCATE TABLE
  "IssueActivity",
  "IssueComment",
  "IssueAttachment",
  "Issue",
  "UserPreference",
  "IssueNumberCounter",
  "GitlabWebhookDelivery",
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
