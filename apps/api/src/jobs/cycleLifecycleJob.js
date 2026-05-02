const { prisma } = require("../repositories/prisma");

async function closeExpiredCycles(now = new Date()) {
  await prisma.cycle.updateMany({
    where: {
      status: "active",
      endsAt: { lt: now }
    },
    data: { status: "closed", updatedAt: now }
  });
}

module.exports = { closeExpiredCycles };
