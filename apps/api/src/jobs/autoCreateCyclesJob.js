const { prisma } = require("../repositories/prisma");

function startOfDayUtc(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d, n) {
  const x = startOfDayUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function nextWeekdayOnOrAfterUtc(date, wd) {
  const s = startOfDayUtc(date);
  const diff = (wd - s.getUTCDay() + 7) % 7;
  return addDaysUtc(s, diff);
}

function normalizeTeamCycleSettings(team) {
  let durationDays = Number(team.iterationDurationDays ?? 14);
  if (!Number.isFinite(durationDays) || durationDays < 1) {
    durationDays = 14;
  }
  let cooldownDays = Number(team.cooldownDays ?? 2);
  if (!Number.isFinite(cooldownDays) || cooldownDays < 0) {
    cooldownDays = 0;
  }
  let startWeekday = Number(team.iterationStartWeekday ?? 1);
  if (!Number.isFinite(startWeekday)) {
    startWeekday = 1;
  }
  startWeekday = Math.min(6, Math.max(0, Math.round(startWeekday)));
  return {
    durationDays: Math.round(durationDays),
    cooldownDays: Math.round(cooldownDays),
    startWeekday
  };
}

function cycleNameFromStart(startUtc) {
  const iso = startUtc.toISOString().slice(0, 10);
  return `Cycle ${iso}`;
}

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

/**
 * 为开启「自动创建日常迭代」的 Team 按其设置自动补齐未来若干个日常 Cycle（kind=daily）
 * - 仅处理 autoCreateDailyCycles=true 的团队；仅统计 / 创建 kind=daily（与项目迭代无关）
 * - 不会重复创建（按 startsAt 精确去重）
 * - 若已有未来日常迭代但不足 targetCount，则在最后一个 endsAt 之后追加
 */
async function ensureFutureTeamCycles({ now = new Date(), targetCount = 1 } = {}) {
  const today = startOfDayUtc(now);

  const teams = await prisma.team.findMany({
    include: { workspace: { select: { organizationId: true } } }
  });

  let createdCount = 0;
  for (const team of teams) {
    if (team.autoCreateDailyCycles === false) {
      continue;
    }
    const workspaceId = team.workspaceId;
    const organizationId = team.workspace?.organizationId;
    if (!workspaceId || !organizationId) {
      continue;
    }

    const settings = normalizeTeamCycleSettings(team);
    const existing = await prisma.cycle.findMany({
      where: { workspaceId, teamId: team.id, organizationId, kind: "daily" },
      orderBy: { startsAt: "asc" },
      select: { id: true, startsAt: true, endsAt: true }
    });

    const existingStartIso = new Set(existing.map((c) => startOfDayUtc(c.startsAt).toISOString()));
    const upcoming = existing.filter((c) => startOfDayUtc(c.startsAt) >= today);
    if (upcoming.length >= targetCount) {
      continue;
    }

    const lastEnd = existing.length ? existing[existing.length - 1].endsAt : null;
    const baseFrom = lastEnd ? addDaysUtc(lastEnd, 1 + settings.cooldownDays) : today;
    let cursor = nextWeekdayOnOrAfterUtc(baseFrom, settings.startWeekday);

    /** 追加直到未来 targetCount 个 startsAt >= today */
    const toCreate = [];
    function projectedUpcomingCount(extraList) {
      let extra = 0;
      for (const x of extraList) {
        if (startOfDayUtc(x.startsAt) >= today) {
          extra += 1;
        }
      }
      return upcoming.length + extra;
    }

    let guard = 0;
    while (projectedUpcomingCount(toCreate) < targetCount) {
      guard += 1;
      if (guard > 40) {
        break;
      }
      const start = startOfDayUtc(cursor);
      const end = addDaysUtc(start, settings.durationDays - 1);
      const startIso = start.toISOString();
      if (!existingStartIso.has(startIso)) {
        toCreate.push({
          organizationId,
          workspaceId,
          teamId: team.id,
          projectId: null,
          kind: "daily",
          name: cycleNameFromStart(start),
          startsAt: start,
          endsAt: end,
          status: computeCycleStatus(start, end, now)
        });
        existingStartIso.add(startIso);
      }
      const afterCooldown = addDaysUtc(end, 1 + settings.cooldownDays);
      cursor = nextWeekdayOnOrAfterUtc(afterCooldown, settings.startWeekday);
    }

    if (toCreate.length) {
      await prisma.cycle.createMany({ data: toCreate });
      createdCount += toCreate.length;
    }
  }

  return { createdCount };
}

module.exports = { ensureFutureTeamCycles };

