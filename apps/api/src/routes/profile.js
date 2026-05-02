const express = require("express");
const { prisma } = require("../repositories/prisma");

const profileRouter = express.Router();

profileRouter.get("/", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.context.userId } });
  if (!user) {
    return res.status(404).json({ message: "Profile not found" });
  }

  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    persistedIn: "User"
  });
});

profileRouter.patch("/", async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "name is required" });
  }

  const user = await prisma.user.update({
    where: { id: req.context.userId },
    data: { name: name.trim() }
  });

  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    persistedIn: "User"
  });
});

module.exports = { profileRouter };
