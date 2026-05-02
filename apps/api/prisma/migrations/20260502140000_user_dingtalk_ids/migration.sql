-- 钉钉静默注册：稳定匹配与展示字段
ALTER TABLE "User" ADD COLUMN "dingTalkUnionId" TEXT;
ALTER TABLE "User" ADD COLUMN "dingTalkStaffId" TEXT;

CREATE UNIQUE INDEX "User_dingTalkUnionId_key" ON "User"("dingTalkUnionId");
