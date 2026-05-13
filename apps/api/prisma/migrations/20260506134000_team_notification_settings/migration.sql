-- Team：notification settings（DingTalk group bot）
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "notificationSettingsJson" JSONB;

