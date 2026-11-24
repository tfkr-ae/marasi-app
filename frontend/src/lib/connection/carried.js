// Desktop-only local Marasi CLI decision helpers:
// - Strict release/nightly version ordering for carried CLI upgrades
//   (matching update_version.go's DD.MM.YYYY[-suffix] and DD.MM.YYYY (nightly <sha>) formats)
// - Proactive carried-CLI upgrade detection and per-version dismissal persistence
// - Calm inline channel-mismatch detection (desktop app channel vs local service channel)
// - Install & restart orchestration (POST /service/restart when connected & supported,
//   falling back to Go's RestartLocalInstance otherwise)
import { cliResultText } from "./cli.js";

const VALID_CHANNELS = new Set(["release", "nightly"]);
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const HEX_COMMIT_RE = /^[0-9a-fA-F]{4,64}$/;

/** Parses an exact DD.MM.YYYY calendar date into a comparable UTC timestamp, or null. */
function parseReleaseDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const ts = Date.UTC(year, month - 1, day);
  const check = new Date(ts);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return ts;
}

/** Parses a release tag "DD.MM.YYYY[-suffix]", matching update_version.go. */
export function parseReleaseVersion(tag) {
  if (typeof tag !== "string" || !tag) return null;
  const dash = tag.indexOf("-");
  const datePart = dash === -1 ? tag : tag.slice(0, dash);
  const suffix = dash === -1 ? "" : tag.slice(dash + 1);
  if (dash !== -1 && suffix === "") return null;
  const date = parseReleaseDate(datePart);
  if (date === null) return null;
  return { date, suffix };
}

/** Compares two runs of digits as arbitrary-length integers. */
function compareDigits(a, b) {
  const na = a.replace(/^0+/, "");
  const nb = b.replace(/^0+/, "");
  if (na.length !== nb.length) return na.length < nb.length ? -1 : 1;
  return na < nb ? -1 : na > nb ? 1 : 0;
}

function nextChunk(s) {
  const digits = s[0] >= "0" && s[0] <= "9";
  let i = 1;
  while (i < s.length && (s[i] >= "0" && s[i] <= "9") === digits) i++;
  return [s.slice(0, i), s.slice(i), digits];
}

/** Natural comparison matching update_version.go's compareNatural ("2" < "10", "" < "1"). */
function compareNatural(a, b) {
  let ra = a;
  let rb = b;
  while (ra !== "" && rb !== "") {
    const [aChunk, aRest, aDigits] = nextChunk(ra);
    const [bChunk, bRest, bDigits] = nextChunk(rb);
    const c =
      aDigits && bDigits ? compareDigits(aChunk, bChunk) : aChunk < bChunk ? -1 : aChunk > bChunk ? 1 : 0;
    if (c !== 0) return c;
    ra = aRest;
    rb = bRest;
  }
  if (ra === rb) return 0;
  return ra === "" ? -1 : 1;
}

/** Parses a nightly version string "DD.MM.YYYY (nightly <commit>)", matching update_version.go. */
export function parseNightlyVersion(s) {
  if (typeof s !== "string" || !s) return null;
  const sep = " (nightly ";
  const idx = s.indexOf(sep);
  if (idx === -1 || !s.endsWith(")")) return null;
  const datePart = s.slice(0, idx);
  const commit = s.slice(idx + sep.length, -1);
  if (!HEX_COMMIT_RE.test(commit)) return null;
  const date = parseReleaseDate(datePart);
  if (date === null) return null;
  return { date, commit };
}

/** Whether two git commit hashes name the same commit (case-insensitive prefix match). */
function sameCommit(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la.startsWith(lb) || lb.startsWith(la);
}

/**
 * Reports whether the carried CLI is strictly newer than the installed local CLI
 * on the same non-dev channel (`release` or `nightly`).
 *
 * - Release: strictly later date, or same date with a naturally greater suffix.
 * - Nightly: distinct commit and strictly later date (same-day different commits
 *   cannot be ordered without git history, so never risk prompting a downgrade).
 */
export function isCarriedNewer(carried, cli) {
  if (!carried?.available || !cli?.found) return false;
  if (!VALID_CHANNELS.has(carried.channel) || carried.channel !== cli.channel) return false;
  if (!carried.version || carried.version === "dev" || !cli.version || cli.version === "dev") return false;

  if (carried.channel === "release") {
    const c = parseReleaseVersion(carried.version);
    const l = parseReleaseVersion(cli.version);
    if (!c || !l) return false;
    if (c.date !== l.date) return c.date > l.date;
    return compareNatural(c.suffix, l.suffix) > 0;
  }

  const c = parseNightlyVersion(carried.version);
  const l = parseNightlyVersion(cli.version);
  if (!c || !l) return false;
  if (sameCommit(c.commit, l.commit)) return false;
  return c.date > l.date;
}

/** localStorage key recording the carried CLI version the user dismissed. */
export const CARRIED_DISMISSED_KEY = "marasi.carriedCli.dismissedVersion";

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads the dismissed carried-CLI version, or null when unset/unavailable. */
export function readDismissedCarriedVersion(storage = safeLocalStorage()) {
  if (!storage?.getItem) return null;
  try {
    const value = storage.getItem(CARRIED_DISMISSED_KEY);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

/** Persists (or clears when empty) the dismissed carried-CLI version. */
export function writeDismissedCarriedVersion(version, storage = safeLocalStorage()) {
  if (!storage) return;
  try {
    if (version) storage.setItem?.(CARRIED_DISMISSED_KEY, String(version));
    else storage.removeItem?.(CARRIED_DISMISSED_KEY);
  } catch {
    // Ignore storage errors (private mode, test environments).
  }
}

/**
 * Proactive carried-CLI upgrade prompt for the active connection, or null when
 * suppressed. Triggers ONLY on desktop, on a connected local connection, when
 * the build carries a strictly newer same-channel CLI for a non-dev local CLI
 * and non-dev service, `restartRequired` is false, and this carried version has
 * not been dismissed.
 */
export function proactiveCarriedUpgrade({
  mobile = false,
  connectionState = null,
  updateState = null,
  carried = null,
  cli = null,
  dismissedVersion = null,
} = {}) {
  if (mobile) return null;
  if (connectionState?.phase !== "connected") return null;
  if (connectionState?.connection?.kind !== "local") return null;
  if (connectionState?.restarting) return null;
  if (connectionState?.restartRequired || updateState?.restartRequired) return null;
  if (connectionState?.version === "dev" || updateState?.development) return null;
  if (!isCarriedNewer(carried, cli)) return null;

  const serviceChannel = updateState?.channel || connectionState?.channel || null;
  if (serviceChannel && serviceChannel !== carried.channel) return null;

  if (dismissedVersion && dismissedVersion === carried.version) return null;
  return { version: carried.version, channel: carried.channel };
}

/**
 * Calm inline channel-mismatch notice for desktop local connections when the
 * desktop app's build channel differs from the connected non-dev local
 * service's channel, or null otherwise.
 */
export function localChannelMismatch({
  mobile = false,
  connectionState = null,
  updateState = null,
  appChannel = "",
} = {}) {
  if (mobile) return null;
  if (connectionState?.phase !== "connected") return null;
  if (connectionState?.connection?.kind !== "local") return null;
  if (!VALID_CHANNELS.has(appChannel)) return null;
  if (updateState?.supported === false || updateState?.loaded === false) return null;
  if (updateState?.development || connectionState?.version === "dev") return null;

  const serviceChannel = updateState?.channel || connectionState?.channel || null;
  if (!VALID_CHANNELS.has(serviceChannel)) return null;
  if (appChannel === serviceChannel) return null;
  return { appChannel, serviceChannel };
}

/**
 * Installs the carried CLI offline, refreshes local CLI state, and restarts the
 * local instance: using POST /service/restart (with its guards & held-items
 * handling) when the active local connection is connected and supports restart,
 * falling back to Go's RestartLocalInstance otherwise.
 */
export async function applyCarriedCLI({
  installCarried,
  refreshCLI = null,
  connectionState = null,
  connectionId = "local",
  isActive = true,
  instanceRunning = false,
  restartService = null,
  restartLocal = null,
  retryConnection = null,
}) {
  const result = await installCarried();
  const text = cliResultText(result);
  if (result.outcome === "failed") {
    return { ok: false, text, method: "none" };
  }
  await refreshCLI?.(result.cli?.found ? result.cli : null);

  if (isActive && connectionState?.connection?.kind === "local") {
    const targetId = connectionState.connection.id || connectionId;
    if (connectionState.phase === "connected" && connectionState.restartSupported !== false && restartService) {
      restartService();
      return { ok: true, text, method: "service" };
    }
    if (connectionState.phase !== "stopped" && restartLocal) {
      await restartLocal(targetId);
      retryConnection?.();
      return { ok: true, text, method: "local" };
    }
    return { ok: true, text, method: "none" };
  }

  if (!isActive && instanceRunning && restartLocal) {
    await restartLocal(connectionId);
    return { ok: true, text, method: "local" };
  }

  return { ok: true, text, method: "none" };
}
