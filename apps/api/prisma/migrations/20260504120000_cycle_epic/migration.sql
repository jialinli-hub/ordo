-- CreateTable
CREATE TABLE "CycleEpic" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleEpic_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "cycleEpicId" TEXT;

-- CreateIndex
CREATE INDEX "CycleEpic_cycleId_idx" ON "CycleEpic"("cycleId");

-- AddForeignKey
ALTER TABLE "CycleEpic" ADD CONSTRAINT "CycleEpic_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_cycleEpicId_fkey" FOREIGN KEY ("cycleEpicId") REFERENCES "CycleEpic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
