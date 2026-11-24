// Which Settings section a ?section=<id> link opens (settings/+page.svelte).
// Settings → Connection and the Marasi CLI part of Settings → Updates were
// removed when connection and service controls moved into Connections, so
// legacy ?section=connection, ?section=cli, and ?section=updates#cli links
// resolve cleanly by opening the Connections modal instead of landing on a
// missing section.

const connectionsRedirects = new Set(["connection", "cli"]);

/**
 * @param {string | null} requested the ?section= value
 * @param {string} hash the URL hash, such as "#cli"
 * @param {string[]} ids the sections Settings lists
 * @returns {{ section: string | null, part: string | null, openConnections: boolean } | null} null when the link names no section
 */
export function settingsSection(requested, hash, ids) {
  const part = hash?.startsWith("#") && hash.length > 1 ? hash.slice(1) : null;
  if (requested && (connectionsRedirects.has(requested) || (requested === "updates" && part === "cli"))) {
    return { section: null, part: null, openConnections: true };
  }
  if (!requested || !ids.includes(requested)) {
    return null;
  }
  return { section: requested, part, openConnections: false };
}
