/**
 * @param {string | undefined} urlString
 * @returns {{ host: string; port: string; database: string; schema: string } | null}
 */
function summarizeDatabaseUrl(urlString) {
  if (!urlString || typeof urlString !== "string") {
    return null;
  }
  try {
    const u = new URL(urlString.replace(/^postgresql:\/\//i, "http://"));
    const rawDb = decodeURIComponent(u.pathname.replace(/^\//, "") || "").split(/[/?]/)[0];
    const schema =
      typeof u.searchParams.get === "function" ? u.searchParams.get("schema") || "public" : "public";
    return {
      host: u.hostname,
      port: u.port || "5432",
      database: rawDb || "(unknown)",
      schema
    };
  } catch {
    return null;
  }
}

module.exports = { summarizeDatabaseUrl };
