// Proactive update indicators for the active connection:
// - Connection tile primary indicator dot (desktop app rail + mobile bottom bar)
// - Dismissible ConnectionBanner strips for pending restarts (and Ticket 06's
//   desktop carried CLI upgrades).
// Merely-available service updates surface only via the Connection tile dot,
// the one-time toast, and Connection details — never a persistent page banner.
import { restartConfirmCopy, supportsServiceUpdates } from "./detail.js";

const installedVersionOf = (updateState) => {
  if (updateState?.install?.state !== "installed") return null;
  const v = String(updateState.install.version ?? "").trim();
  return v || null;
};

const carriedVersionOf = (carriedUpgrade) => {
  if (!carriedUpgrade || typeof carriedUpgrade !== "object") return null;
  const v = String(carriedUpgrade.version ?? "").trim();
  return v || null;
};

const isRestartPending = (connectionState, updateState) =>
  Boolean(
    (updateState?.restartRequired || connectionState?.restartRequired) &&
      supportsServiceUpdates(connectionState, updateState) &&
      connectionState?.restartSupported !== false,
  );

/**
 * Subtle primary indicator dot on the Connection tile (desktop app rail and
 * mobile bottom bar), or null when healthy, disconnected, or actively restarting.
 * Accepts an optional `carriedUpgrade` (boolean or `{ version }`) for desktop
 * local carried-CLI upgrades alongside `available` and `restartRequired`.
 */
export function connectionTileIndicator(connectionState, updateState, { carriedUpgrade = null } = {}) {
  if (connectionState?.phase !== "connected" || connectionState?.restarting) return null;

  if (isRestartPending(connectionState, updateState)) {
    const version = installedVersionOf(updateState);
    return {
      kind: "restart-required",
      label: version ? `${version} ready — restart to apply` : "Restart to finish updating",
    };
  }

  if (carriedUpgrade) {
    const version = carriedVersionOf(carriedUpgrade);
    return {
      kind: "carried-upgrade",
      label: version ? `Marasi CLI ${version} included` : "Newer Marasi CLI included",
    };
  }

  if (supportsServiceUpdates(connectionState, updateState) && updateState?.available) {
    const version = String(updateState.available.version ?? "").trim();
    return {
      kind: "available",
      label: version ? `Marasi ${version} available` : "Update available",
    };
  }

  return null;
}

/**
 * Identity key for dismissing the restart-required banner within the current
 * connection session/run until a new install completes or the connection switches.
 */
export function restartBannerKey(connectionState, updateState) {
  const id = connectionState?.connection?.id ?? "";
  const session = connectionState?.session ?? 0;
  const runId = connectionState?.runId ?? "";
  const seq = updateState?.installedSeq ?? 0;
  return `${id}:${session}:${runId}:${seq}`;
}

/**
 * Dismissible proactive banner strip for a connected, healthy service (when no
 * higher-priority unhealthy, restarting, or API-warning banner is active).
 * Never renders for merely-available updates or running installs.
 */
export function connectionActionBanner(
  connectionState,
  updateState,
  { dismissedRestartKey = null, carriedUpgrade = null, carriedDismissed = false } = {},
) {
  if (connectionState?.phase !== "connected" || connectionState?.restarting || connectionState?.apiWarning) {
    return null;
  }

  if (connectionState?.restartAsk) {
    return {
      kind: "restart-confirm",
      ...restartConfirmCopy(connectionState.connection),
    };
  }

  const restartPending = isRestartPending(connectionState, updateState);
  if (restartPending) {
    const key = restartBannerKey(connectionState, updateState);
    if (dismissedRestartKey === key) return null;
    const name = connectionState.connection?.name ?? "Marasi";
    const version = installedVersionOf(updateState);
    return {
      kind: "restart-required",
      key,
      name,
      version,
      text: version ? `${name} updated to ${version}.` : `${name} needs a restart to finish updating.`,
    };
  }

  if (carriedUpgrade && !carriedDismissed) {
    const version = carriedVersionOf(carriedUpgrade);
    return {
      kind: "carried-upgrade",
      version,
      text: version ? `Marasi CLI ${version} included.` : "Newer Marasi CLI included.",
    };
  }

  return null;
}
