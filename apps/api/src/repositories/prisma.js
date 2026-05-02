const { PrismaClient } = require("@prisma/client");

const prisma = globalThis.__ordo_prisma__ ?? new PrismaClient();
globalThis.__ordo_prisma__ = prisma;

module.exports = { prisma };
