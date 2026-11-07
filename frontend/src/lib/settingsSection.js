// Which Settings section a ?section=<id> link opens (settings/+page.svelte).
// Marasi CLI was its own section; it is now the CLI part of Updates, so
// ?section=cli and ?section=updates#cli both open Updates scrolled to it.

const aliases = { cli: { section: "updates", part: "cli" } };

/**
 * @param {string | null} requested the ?section= value
 * @param {string} hash the URL hash, such as "#cli"
 * @param {string[]} ids the sections Settings lists
 * @returns {{ section: string, part: string | null } | null} null when the link names no section
 */
export function settingsSection(requested, hash, ids) {
  if (requested && aliases[requested]) {
    return { ...aliases[requested] };
  }
  if (!requested || !ids.includes(requested)) {
    return null;
  }
  const part = hash?.startsWith("#") && hash.length > 1 ? hash.slice(1) : null;
  return { section: requested, part };
}
