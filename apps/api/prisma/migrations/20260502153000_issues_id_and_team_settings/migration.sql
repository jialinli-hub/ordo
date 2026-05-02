-- Issue：issuesId = identifier-issueNumber（大写前缀），用于路由与展示
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "issuesId" TEXT;

UPDATE "Issue" AS i
SET "issuesId" = UPPER(COALESCE(NULLIF(TRIM(i."displayIdentifier"), ''), NULLIF(TRIM(p."key"), ''))) || '-' || i."issueNumber"::text
FROM "Project" AS p
WHERE p."id" = i."projectId" AND (i."issuesId" IS NULL OR i."issuesId" = '');

UPDATE "Issue"
SET "issuesId" = 'X-' || "issueNumber"::text
WHERE "issuesId" IS NULL OR trim("issuesId") = '-';

CREATE UNIQUE INDEX IF NOT EXISTS "Issue_workspaceId_issuesId_key" ON "Issue"("workspaceId", "issuesId");

ALTER TABLE "Issue" ALTER COLUMN "issuesId" SET NOT NULL;

ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "iterationDurationDays" INTEGER DEFAULT 14;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "cooldownDays" INTEGER DEFAULT 2;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "issueLabelsJson" JSONB;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "issueStatusesJson" JSONB;
