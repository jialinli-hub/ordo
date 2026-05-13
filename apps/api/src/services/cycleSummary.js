/**
 * 从一批 issue 行（含 status / type / estimateHours）生成与列表接口一致的 summary 结构。
 * @param {{ status: string, type?: string|null, estimateHours?: number|null }[]} issues
 */
function summarizeCycleIssues(issues) {
  const byStatus = issues.reduce(
    (acc, issue) => {
      acc[issue.status] = (acc[issue.status] || 0) + 1;
      return acc;
    },
    { todo: 0, in_progress: 0, in_review: 0, done: 0 }
  );

  const byType = issues.reduce(
    (acc, issue) => {
      const t = issue.type || "feature";
      if (t === "feature" || t === "bug" || t === "chore") {
        acc[t] += 1;
      } else {
        acc.chore += 1;
      }
      return acc;
    },
    { feature: 0, bug: 0, chore: 0 }
  );

  let estimateHoursTotal = 0;
  let estimateHoursDone = 0;
  let estimateUnset = 0;
  for (const issue of issues) {
    const h = issue.estimateHours;
    if (h == null || !Number.isFinite(Number(h))) {
      estimateUnset += 1;
    } else {
      const n = Number(h);
      estimateHoursTotal += n;
      if (issue.status === "done") {
        estimateHoursDone += n;
      }
    }
  }

  const totalIssues = issues.length;
  const doneIssues = byStatus.done || 0;
  const completionRate = totalIssues === 0 ? 0 : Number(((doneIssues / totalIssues) * 100).toFixed(2));
  const estimateHoursRemaining = Number((estimateHoursTotal - estimateHoursDone).toFixed(2));

  return {
    totalIssues,
    doneIssues,
    inProgressIssues: byStatus.in_progress,
    inReviewIssues: byStatus.in_review,
    todoIssues: byStatus.todo,
    completionRate,
    scopeCount: totalIssues,
    byStatus: {
      todo: byStatus.todo || 0,
      in_progress: byStatus.in_progress || 0,
      in_review: byStatus.in_review || 0,
      done: byStatus.done || 0
    },
    byType,
    estimateHoursTotal: Number(estimateHoursTotal.toFixed(2)),
    estimateHoursDone: Number(estimateHoursDone.toFixed(2)),
    estimateHoursRemaining,
    estimateUnset
  };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function fetchCycleSummary(prisma, organizationId, cycleId) {
  const issues = await prisma.issue.findMany({
    where: { organizationId, cycleId },
    select: { status: true, type: true, estimateHours: true }
  });
  return summarizeCycleIssues(issues);
}

module.exports = { summarizeCycleIssues, fetchCycleSummary };
