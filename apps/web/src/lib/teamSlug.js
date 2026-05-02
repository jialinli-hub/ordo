/** Slug used in URLs: same rules as workspace url slug */

export function slugifyPathSegment(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 团队 URL 段：`name` slug；纯中文或无字母数字时降级为稳定短 id。
 * @param {{ name?: string, id?: string }} teamLike
 */
export function teamSegmentForUrl(teamLike) {
  const nameSlug = slugifyPathSegment(teamLike?.name ?? "");
  if (nameSlug.length > 0) {
    return nameSlug;
  }
  const id = teamLike?.id || "";
  if (!id) {
    return "team";
  }
  return `team-${id.replace(/-/g, "").slice(0, 12)}`;
}

export function findTeamFromUrlSegment(teams, segment) {
  if (!teams?.length || segment == null) {
    return null;
  }
  const seg = decodeURIComponent(segment);
  const byId = teams.find((t) => t.id === seg);
  if (byId) {
    return byId;
  }
  const bySlug = teams.find((t) => slugifyPathSegment(t.name) === seg);
  if (bySlug) {
    return bySlug;
  }
  if (seg.startsWith("team-")) {
    const rest = seg.slice("team-".length);
    return (
      teams.find((t) => t.id.replace(/-/g, "").startsWith(rest)) ||
      teams.find((t) => t.id.startsWith(rest))
    );
  }
  return null;
}
