/**
 * 根据「迭代开始周几 + 迭代天数 + 冷静期」预览若干次迭代的起止日期（自然日，本地时区）。
 * @param {object} p
 * @param {number} p.startWeekday 0=周日 … 6=周六（与 Date.getDay 一致）
 * @param {number} p.durationDays 单次迭代天数（>=1）
 * @param {number} p.cooldownDays 迭代之间的冷静期天数（>=0）
 * @param {number} [p.count]
 * @param {Date} [p.fromDate]
 */
export function previewTeamIterations({
  startWeekday,
  durationDays,
  cooldownDays,
  count = 3,
  fromDate = new Date()
}) {
  let dNum = Number(durationDays);
  if (!Number.isFinite(dNum) || dNum < 1) {
    dNum = 14;
  }
  let cNum = Number(cooldownDays);
  if (!Number.isFinite(cNum) || cNum < 0) {
    cNum = 0;
  }
  let dow = Number(startWeekday);
  if (!Number.isFinite(dow)) {
    dow = 1;
  }
  dow = Math.min(6, Math.max(0, Math.round(dow)));

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const x = startOfDay(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function nextWeekdayOnOrAfter(date, wd) {
    const s = startOfDay(date);
    const diff = (wd - s.getDay() + 7) % 7;
    return addDays(s, diff);
  }

  let cursor = nextWeekdayOnOrAfter(fromDate, dow);
  const rows = [];

  for (let i = 0; i < count; i++) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const lastDay = addDays(start, dNum - 1);
    rows.push({ start, end: lastDay });
    const afterCooldown = addDays(lastDay, 1 + cNum);
    cursor = nextWeekdayOnOrAfter(afterCooldown, dow);
  }

  return rows;
}

export const WEEKDAY_OPTIONS_JS = [
  { value: 0, label: "周日" },
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" }
];
