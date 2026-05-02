-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "parentIssueId" TEXT;

-- CreateIndex
CREATE INDEX "Issue_parentIssueId_idx" ON "Issue"("parentIssueId");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_parentIssueId_fkey" FOREIGN KEY ("parentIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
