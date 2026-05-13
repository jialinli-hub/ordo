-- Drop binary attachments; link-based PRD / other files on Requirement
DROP TABLE IF EXISTS "RequirementAttachment";

ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "prdUrl" TEXT;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "otherFilesJson" JSONB;
