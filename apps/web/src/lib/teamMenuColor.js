const FALLBACK_PALETTE = [
  "#4f46e5",
  "#0891b2",
  "#0d9488",
  "#059669",
  "#ca8a04",
  "#d97706",
  "#dc2626",
  "#db2777",
  "#9333ea",
  "#6366f1"
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** 优先使用后端创建时分配的 accentColor，旧数据按 id 哈希回退 */
export function teamMenuColor(team) {
  if (team?.accentColor) {
    return team.accentColor;
  }
  const id = team?.id || "";
  return FALLBACK_PALETTE[hashString(id) % FALLBACK_PALETTE.length];
}
