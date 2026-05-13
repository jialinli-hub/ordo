-- Team：workflow automations（GitLab Webhook / PR 流转规则）
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "workflowAutomationsJson" JSONB;

