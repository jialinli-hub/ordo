-- Workspace 级 GitLab 集成（webhook 密钥）+ 投递记录
ALTER TABLE "Workspace" ADD COLUMN "gitlabIntegrationJson" JSONB;

CREATE TABLE "GitlabWebhookDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "gitlabEventHeader" TEXT,
    "objectKind" TEXT,
    "summary" TEXT NOT NULL,
    "matchedIssueKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitlabWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GitlabWebhookDelivery_workspaceId_createdAt_idx" ON "GitlabWebhookDelivery"("workspaceId", "createdAt");

ALTER TABLE "GitlabWebhookDelivery" ADD CONSTRAINT "GitlabWebhookDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
