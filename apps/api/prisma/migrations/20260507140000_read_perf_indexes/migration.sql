-- 读路径优化：列表 / 过滤 / 排序 / cycle 汇总常用组合索引
CREATE INDEX IF NOT EXISTS "Team_workspaceId_idx" ON "Team"("workspaceId");

CREATE INDEX IF NOT EXISTS "Project_organizationId_workspaceId_idx" ON "Project"("organizationId", "workspaceId");

CREATE INDEX IF NOT EXISTS "Cycle_workspaceId_startsAt_idx" ON "Cycle"("workspaceId", "startsAt");

CREATE INDEX IF NOT EXISTS "Cycle_workspaceId_teamId_idx" ON "Cycle"("workspaceId", "teamId");

CREATE INDEX IF NOT EXISTS "Cycle_workspaceId_projectId_idx" ON "Cycle"("workspaceId", "projectId");

CREATE INDEX IF NOT EXISTS "Issue_cycleId_idx" ON "Issue"("cycleId");

CREATE INDEX IF NOT EXISTS "Issue_workspaceId_assigneeId_idx" ON "Issue"("workspaceId", "assigneeId");

CREATE INDEX IF NOT EXISTS "Issue_workspaceId_updatedAt_idx" ON "Issue"("workspaceId", "updatedAt");
