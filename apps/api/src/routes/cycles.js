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

    select: { status: true }

  });

  const byStatus = issues.reduce(

    (acc, issue) => {

      acc[issue.status] = (acc[issue.status] || 0) + 1;

      return acc;

    },

    { todo: 0, in_progress: 0, in_review: 0, done: 0 }

  );

  const totalIssues = issues.length;

  const doneIssues = byStatus.done || 0;

  const completionRate = totalIssues === 0 ? 0 : Number(((doneIssues / totalIssues) * 100).toFixed(2));

  return {

    totalIssues,

    doneIssues,

    inProgressIssues: byStatus.in_progress,

    inReviewIssues: byStatus.in_review,

    todoIssues: byStatus.todo,

    completionRate,

    scopeCount: totalIssues

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

    orderBy: { createdAt: "desc" }

  });



  const items = await Promise.all(

    rows.map(async (cycle) => ({

      ...mapCycle(cycle),

      summary: await buildCycleSummary(organizationId, cycle.id)

    }))

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

    select: { status: true, type: true, priority: true, cycleId: true, estimateHours: true }

  });



  const byStatus = { todo: 0, in_progress: 0, in_review: 0, done: 0 };

  const byType = { feature: 0, bug: 0, chore: 0 };

  const byPriority = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

  let estimateSum = 0;



  for (const row of issues) {

    const st = row.status;

    byStatus[st] = (byStatus[st] || 0) + 1;

    const tp = row.type;

    byType[tp] = (byType[tp] || 0) + 1;

    const pri = row.priority ?? 0;

    byPriority[pri] = (byPriority[pri] || 0) + 1;

    estimateSum += Number(row.estimateHours) || 0;

  }



  const cycleRows = await prisma.cycle.findMany({

    where: { workspaceId, organizationId, teamId },

    orderBy: { startsAt: "desc" }

  });



  const cycleSlices = await Promise.all(

    cycleRows.slice(0, 8).map(async (c) => ({

      id: c.id,

      name: c.name,

      startsAt: c.startsAt.toISOString(),

      endsAt: c.endsAt.toISOString(),

      status: c.status,

      summary: await buildCycleSummary(organizationId, c.id)

    }))

  );



  return res.json({

    teamId: team.id,

    teamName: team.name,

    issueTotals: {

      count: issues.length,

      estimateHours: estimateSum,

      byStatus,

      byType,

      byPriority

    },

    cycles: cycleSlices

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

