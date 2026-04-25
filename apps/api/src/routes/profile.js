const express = require("express");
const { store } = require("../repositories/memoryStore");

const profileRouter = express.Router();

profileRouter.get("/", (req, res) => {
  const user = store.users.find((item) => item.id === req.context.userId);
  if (!user) {
    return res.status(404).json({ message: "Profile not found" });
  }

  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl
  });
});

module.exports = { profileRouter };
