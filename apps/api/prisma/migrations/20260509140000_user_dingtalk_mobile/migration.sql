-- 钉钉群内 @：同步用户手机号（登录时从开放平台 users/me 获取）
ALTER TABLE "User" ADD COLUMN "dingTalkMobile" TEXT;
