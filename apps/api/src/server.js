const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const app = require("./app");
const { prisma } = require("./repositories/prisma");
const { summarizeDatabaseUrl } = require("./utils/databaseSummary");

const port = Number(process.env.PORT) || 3000;

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL 未配置，API 必须使用 PostgreSQL 连接串启动。");
    process.exit(1);
  }

  await prisma.$connect();

  const s = summarizeDatabaseUrl(process.env.DATABASE_URL);
  if (s) {
    console.log(
      `[ordo-api] PostgreSQL 连接: host=${s.host} port=${s.port} db=${s.database} schema=${s.schema}`
    );
  }
  try {
    const n = await prisma.user.count();
    console.log(`[ordo-api] 启动时 \"User\" 表行数: ${n}`);
  } catch (e) {
    console.error('[ordo-api] 无法读取 "User" 表（迁移 / Prisma generate 是否与库一致）:', e.message);
  }

  app.listen(port, () => {
    console.log(`API server is running on port ${port}`);
  });
}

process.on("beforeExit", async () => {
  await prisma.$disconnect().catch(() => undefined);
});

start().catch(async (error) => {
  console.error("Failed to start API server:", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
