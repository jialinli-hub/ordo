-- AlterTable
ALTER TABLE "WorkspaceInvite" ADD COLUMN "contextTeamId" TEXT;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_contextTeamId_fkey" FOREIGN KEY ("contextTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkspaceInvite_contextTeamId_idx" ON "WorkspaceInvite"("contextTeamId");
