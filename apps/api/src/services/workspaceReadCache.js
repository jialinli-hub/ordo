const { LRUCache } = require("lru-cache");

/**
 * 进程内 LRU 读缓存：限制条目数 + TTL，避免无界内存。
 * ORDO_API_READ_CACHE_MAX=0 关闭；ORDO_API_READ_CACHE_TTL_MS 默认 12s。
 */
const maxEntries = Math.max(0, Number(process.env.ORDO_API_READ_CACHE_MAX ?? 400));
const ttlMs = Math.max(500, Number(process.env.ORDO_API_READ_CACHE_TTL_MS ?? 12_000));

const cache =
  maxEntries > 0
    ? new LRUCache({
        max: maxEntries,
        ttl: ttlMs,
        updateAgeOnGet: true,
        allowStale: false
      })
    : null;

function isEnabled() {
  return Boolean(cache);
}

/**
 * @param {string[]} parts 建议含 workspaceId 片段，便于 {@link invalidateWorkspace} 按工作区淘汰
 */
function makeKey(parts) {
  return parts.map((p) => String(p ?? "")).join(":");
}

function getJson(key) {
  if (!cache) {
    return undefined;
  }
  const hit = cache.get(key);
  return hit === undefined ? undefined : hit;
}

function setJson(key, value) {
  if (!cache) {
    return;
  }
  cache.set(key, value);
}

/** 约定 key 含 :<workspaceId>:...，按工作区整批淘汰（含 v1/v2 等项目列表缓存） */
function invalidateWorkspace(workspaceId) {
  if (!cache || !workspaceId) {
    return;
  }
  const needle = `:${workspaceId}:`;
  for (const k of cache.keys()) {
    if (k.includes(needle)) {
      cache.delete(k);
    }
  }
}

module.exports = {
  isEnabled,
  makeKey,
  getJson,
  setJson,
  invalidateWorkspace
};
