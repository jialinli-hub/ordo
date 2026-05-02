/**
 * 开发/本地默认数据：与 auth 中 organizationId = "org-dev" 对齐。
 * 运行：在 apps/api 目录且已配置 DATABASE_URL 后执行 `npm run db:seed`
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.organization.upsert({
    where: { id: "org-dev" },
    create: {
      id: "org-dev",
      name: "Default organization"
    },
    update: {
      name: "Default organization"
    }
  });

  console.log('Seeded Organization id="org-dev".');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
