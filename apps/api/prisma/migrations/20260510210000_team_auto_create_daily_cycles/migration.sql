-- Team：是否由定时任务自动创建日常迭代（kind=daily）
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "autoCreateDailyCycles" BOOLEAN NOT NULL DEFAULT true;
