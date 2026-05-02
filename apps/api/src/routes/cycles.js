const express = require("express");

const { prisma } = require("../repositories/prisma");



const cyclesRouter = express.Router();



function computeCycleStatus(startsAt, endsAt, now = new Date()) {

  const start = new Date(startsAt);

  const end = new Date(endsAt);

  if (now < start) {

    return "planned";

  }

  if (now > end) {

    return "closed";

  }

  return "active";

}



async function buildCycleSummary(organizationId, cycleId) {
  const issues = await prisma.issue.findMany({
    where: { organizationId, cycleId },
    select: { status: true, type: true, estimateHours: true }
  });

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



function mapCycle(row) {

  return {

    id: row.id,

    organizationId: row.organizationId,

    workspaceId: row.workspaceId,

    projectId: row.projectId,

    teamId: row.teamId,

    name: row.name,

    startsAt: row.startsAt.toISOString(),

    endsAt: row.endsAt.toISOString(),

    status: row.status,

    createdAt: row.createdAt.toISOString(),

    updatedAt: row.updatedAt.toISOString()

  };

}



cyclesRouter.post("/", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const { projectId = null, teamId = null, name, startsAt, endsAt } = req.body ?? {};

  if (!name || !startsAt || !endsAt) {

    return res.status(400).json({ message: "name, startsAt, endsAt are required" });

  }

  if (new Date(startsAt) > new Date(endsAt)) {

    return res.status(422).json({ message: "startsAt must be before or equal to endsAt" });

  }



  if (projectId) {

    const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId } });

    if (!p) {

      return res.status(422).json({ message: "invalid projectId" });

    }

  }

  if (teamId) {

    const t = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });

    if (!t) {

      return res.status(422).json({ message: "invalid teamId" });

    }

  }



  const row = await prisma.cycle.create({

    data: {

      organizationId,

      workspaceId,

      projectId,

      teamId,

      name,

      startsAt: new Date(startsAt),

      endsAt: new Date(endsAt),

      status: computeCycleStatus(startsAt, endsAt)

    }

  });



  return res.status(201).json(mapCycle(row));

});



cyclesRouter.get("/", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const { projectId, teamId } = req.query;

  const rows = await prisma.cycle.findMany({

    where: {

      organizationId,

      workspaceId,

      ...(projectId ? { projectId } : {}),

      ...(teamId ? { teamId } : {})

    },

    orderBy: { startsAt: "desc" }

  });



  const items = await Promise.all(
    rows.map(async (cycle) => {
      const epics = await prisma.cycleEpic.findMany({
        where: { cycleId: cycle.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true }
      });
      return {
        ...mapCycle(cycle),
        summary: await buildCycleSummary(organizationId, cycle.id),
        epics
      };
    })
  );

  return res.json({ items });

});



cyclesRouter.get("/team-metrics", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const teamId = req.query.teamId;

  if (!teamId) {

    return res.status(400).json({ message: "teamId is required" });

  }



  const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });

  if (!team) {

    return res.status(404).json({ message: "team not found" });

  }



  const issues = await prisma.issue.findMany({
    where: { workspaceId, organizationId, teamId },
    select: { status: true, type: true, cycleId: true, estimateHours: true }
  });

  const byStatus = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
  const byType = { feature: 0, bug: 0, chore: 0 };
  const byEstimate = { unset: 0, lte2: 0, mid: 0, gte8: 0 };
  let estimateSum = 0;

  for (const row of issues) {
    const st = row.status;
    byStatus[st] = (byStatus[st] || 0) + 1;
    const tp = row.type;
    byType[tp] = (byType[tp] || 0) + 1;
    estimateSum += Number(row.estimateHours) || 0;
    const h = row.estimateHours;
    if (h == null || !Number.isFinite(Number(h))) {
      byEstimate.unset += 1;
    } else {
      const n = Number(h);
      if (n <= 2) {
        byEstimate.lte2 += 1;
      } else if (n >= 8) {
        byEstimate.gte8 += 1;
      } else {
        byEstimate.mid += 1;
      }
    }
  }

  return res.json({
    teamId: team.id,
    teamName: team.name,
    issueTotals: {
      count: issues.length,
      estimateHours: estimateSum,
      byStatus,
      byType,
      byEstimate
    }
  });

});

cyclesRouter.get("/:id/epics", async (req, res) => {
  const workspaceId = req.context.workspaceId;
  const cycle = await prisma.cycle.findFirst({
    where: { id: req.params.id, workspaceId }
  });
  if (!cycle) {
    return res.status(404).json({ message: "Cycle not found" });
  }
  const rows = await prisma.cycleEpic.findMany({
    where: { cycleId: cycle.id },
    orderBy: { sortOrder: "asc" }
  });
  return res.json({
    items: rows.map((r) => ({
      id: r.id,
      cycleId: r.cycleId,
      name: r.name,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString()
    }))
  });
});

cyclesRouter.post("/:id/epics", async (req, res) => {
  const workspaceId = req.context.workspaceId;
  const organizationId = req.context.organizationId;
  const cycle = await prisma.cycle.findFirst({
    where: { id: req.params.id, workspaceId, organizationId }
  });
  if (!cycle) {
    return res.status(404).json({ message: "Cycle not found" });
  }
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }
  const maxOrder = await prisma.cycleEpic.aggregate({
    where: { cycleId: cycle.id },
    _max: { sortOrder: true }
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
  const row = await prisma.cycleEpic.create({
    data: {
      cycleId: cycle.id,
      name,
      sortOrder
    }
  });
  return res.status(201).json({
    id: row.id,
    cycleId: row.cycleId,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
});

cyclesRouter.get("/:id/report", async (req, res) => {

  const organizationId = req.context.organizationId;

  const workspaceId = req.context.workspaceId;

  const cycle = await prisma.cycle.findFirst({

    where: { id: req.params.id, organizationId, workspaceId }

  });

  if (!cycle) {

    return res.status(404).json({ message: "Cycle not found" });

  }



  const issues = await prisma.issue.findMany({

    where: { organizationId, cycleId: cycle.id },

    select: { status: true, estimateHours: true }

  });

  const totalIssues = issues.length;

  const doneIssues = issues.filter((issue) => issue.status === "done").length;

  const byStatus = issues.reduce(

    (acc, issue) => {

      acc[issue.status] = (acc[issue.status] || 0) + 1;

      return acc;

    },

    { todo: 0, in_progress: 0, in_review: 0, done: 0 }

  );

  const totalEstimateHours = issues.reduce((acc, issue) => acc + (Number(issue.estimateHours) || 0), 0);

  const doneEstimateHours = issues

    .filter((issue) => issue.status === "done")

    .reduce((acc, issue) => acc + (Number(issue.estimateHours) || 0), 0);



  return res.json({

    cycleId: cycle.id,

    cycleName: cycle.name,

    totalIssues,

    doneIssues,

    completionRate: totalIssues === 0 ? 0 : Number(((doneIssues / totalIssues) * 100).toFixed(2)),

    byStatus,

    totalEstimateHours,

    doneEstimateHours,

    remainingEstimateHours: totalEstimateHours - doneEstimateHours

  });

});



module.exports = { cyclesRouter };

