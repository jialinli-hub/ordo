-- AlterTable
ALTER TABLE "Project" ADD COLUMN "description" TEXT,
ADD COLUMN "leadUserId" TEXT;

ALTER TABLE "Project" ADD CONSTRAINT "Project_leadUserId_fkey" FOREIGN KEY ("leadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Project_leadUserId_idx" ON "Project"("leadUserId");
