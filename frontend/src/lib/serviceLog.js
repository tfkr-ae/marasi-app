// The Service log drawer's logic: its level filter, and opening the pair a
// line names. ServiceLog.svelte draws it; homeStore holds the lines (homeApi's
// toLog shape: Level, Message, RequestID, ExtensionID, Timestamp).

const RANK = { DEBUG: 0, INFO: 1, WARN: 2, WARNING: 2, ERROR: 3, FATAL: 4 };

/** The level filter's choices, least severe first. Each shows its level and up. */
export const LEVEL_FILTERS = [
  { id: "all", label: "All", min: -Infinity },
  { id: "info", label: "Info", min: RANK.INFO },
  { id: "warn", label: "Warn", min: RANK.WARN },
  { id: "error", label: "Error", min: RANK.ERROR },
];

const rankOf = (level) => RANK[String(level ?? "").toUpperCase()] ?? -Infinity;

/** The lines the filter `id` shows: all of them by default. */
export function filterByLevel(lines, id = "all") {
  const min = LEVEL_FILTERS.find((f) => f.id === id)?.min ?? -Infinity;
  return min === -Infinity ? lines : lines.filter((line) => rankOf(line.Level) >= min);
}

/** Whether a line names a pair, so clicking it opens that pair. */
export const canOpenPair = (line) => Boolean(line?.RequestID);

/**
 * Opens the pair a line names in the Ledger, selected so its drawer shows,
 * as Drawings' Open ↗ does. `pairNumber(id)` reads the pair's number, null
 * when the project no longer holds it. Returns whether it opened one.
 */
export async function openPair(line, { pairNumber, goto, ledger }) {
  if (!canOpenPair(line)) return false;
  const number = await pairNumber(line.RequestID);
  if (number == null) return false;
  await goto("/ledger");
  const { pair } = await ledger.goToNumber(number);
  if (pair) ledger.selectPair(pair.ID);
  return true;
}

/** The app drawer's settings for the Service log (AppDrawer.svelte). */
export const SERVICE_LOG_DRAWER = { id: "service-log", position: "bottom", height: "h-3/5" };

/** Opens the Service log in the app drawer, or closes it when it shows. */
export function toggleServiceLog(drawerStore, current) {
  if (current?.open && current.id === SERVICE_LOG_DRAWER.id) drawerStore.close();
  else drawerStore.open(SERVICE_LOG_DRAWER);
}
