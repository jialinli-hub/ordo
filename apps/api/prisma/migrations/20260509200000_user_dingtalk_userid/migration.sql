-- 群机器人 at.atUserIds：开放平台 users/me 返回的 userId（与 unionId、staffId 不同）
ALTER TABLE "User" ADD COLUMN "dingTalkUserId" TEXT;
