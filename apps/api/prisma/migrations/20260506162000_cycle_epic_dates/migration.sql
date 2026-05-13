-- CycleEpic：预计提测日期、预计发布日期
ALTER TABLE "CycleEpic" ADD COLUMN IF NOT EXISTS "plannedTestAt" TIMESTAMP(3);
ALTER TABLE "CycleEpic" ADD COLUMN IF NOT EXISTS "releaseAt" TIMESTAMP(3);

