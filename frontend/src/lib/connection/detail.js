// Presentation helpers for the Connection details layout (ConnectionDetail.svelte):
// identity header metadata, inline stop/restart confirmation copy, service update
// actions/progress/contextual-slot precedence, and collapsed setup disclosure header.
import { nightlyNotes } from "../updates.js";

/** Host, instance, and OS metadata line under the connection name. */
export function detailWhereText(connection, { instance = null, os = null } = {}) {
  const host =
    connection.kind === "local" ? "This machine" : (connection.url?.replace(/^https?:\/\//, "") ?? "");
  const inst = instance || (connection.kind === "local" ? connection.instance : null) || null;
  return [host, inst ? `instance ${inst}` : null, os || null].filter(Boolean).join(" · ");
}

/** Service version, build channel, and API level line, or null before reaching a service. */
export function serviceMetaText({ version = null, channel = null, api = null } = {}) {
  if (!version) return null;
  const hasChannel = channel && version.toLowerCase().includes(`(${channel.toLowerCase()}`);
  const ch = channel && !hasChannel ? ` (${channel})` : "";
  return `Marasi ${version}${ch} · API ${api ?? "none"}`;
}

/** Concise inline Stop confirmation copy for the contextual slot. */
export function stopConfirmCopy(connection) {
  return {
    title: `Stop ${connection.name}?`,
    detail:
      connection.kind === "remote"
        ? "You'll need to start it again on the remote host."
        : "Another program started this instance.",
  };
}

/** Concise inline Restart confirmation copy for remote or unowned local runs. */
export function restartConfirmCopy(connection) {
  return {
    title: `Restart ${connection.name}?`,
    detail: "Active connections will drop while the project reopens.",
  };
}

/** Collapsed setup disclosure heading and mono summary. */
export function setupDisclosure(connection, { channel = null, version = null, mobile = false } = {}) {
  const title =
    connection.kind === "remote" || mobile ? "Update channel & reinstall" : "Channel, CLI path & quit behavior";
  const summary = channel || (version === "dev" ? "dev" : "");
  return { title, summary };
}

const SERVICE_UPDATE_STEPS = ["Download", "Verify", "Install", "Restart"];

const supportsServiceUpdates = (connectionState, updateState) =>
  Boolean(updateState?.supported !== false && !updateState?.development && connectionState?.version !== "dev");

const isUpdateInstalling = (updateState) =>
  Boolean(updateState?.install?.state === "running" || updateState?.startingInstall);

const isUpdateRestartRequired = (connectionState, updateState) =>
  Boolean(updateState?.restartRequired || connectionState?.restartRequired);

/**
 * Primary service-update button for the connected top action bar, or null when
 * update controls are hidden (development build or 404/501 unsupported service).
 */
export function serviceUpdateAction(connectionState, updateState) {
  if (!supportsServiceUpdates(connectionState, updateState)) return null;
  const connBusy = Boolean(connectionState?.busy !== null || connectionState?.restarting || connectionState?.restartConfirming);

  if (isUpdateRestartRequired(connectionState, updateState)) {
    if (!connectionState?.restartSupported) return null;
    return {
      kind: "restart",
      label: connectionState?.restarting ? "Restarting…" : "Restart to apply",
      primary: true,
      disabled: connBusy,
      spinning: Boolean(connectionState?.restarting),
      hideNeutralRestart: true,
    };
  }

  if (isUpdateInstalling(updateState)) {
    return {
      kind: "installing",
      label: "Updating…",
      primary: true,
      disabled: true,
      spinning: false,
      hideNeutralRestart: false,
    };
  }

  if (updateState?.available) {
    return {
      kind: "install",
      label: `Update to ${updateState.available.version}`,
      primary: true,
      disabled: connBusy || Boolean(updateState?.checking),
      spinning: false,
      hideNeutralRestart: false,
    };
  }

  return {
    kind: "check",
    label: updateState?.checking ? "Checking…" : "Check update",
    primary: false,
    disabled: connBusy || Boolean(updateState?.checking),
    spinning: Boolean(updateState?.checking),
    hideNeutralRestart: false,
  };
}

/**
 * State for the inline 4-step update tracker (`Download → Verify → Install → Restart`).
 * Cancel is offered only while downloading or verifying, disappearing once swap begins.
 */
export function serviceUpdateProgress(updateState, connectionName) {
  const install = updateState?.install ?? null;
  const restartRequired = Boolean(updateState?.restartRequired || install?.state === "installed");
  const step = install?.step || "download";
  const swapping = step === "install" || step === "swap";

  const stepIndex = restartRequired ? 3 : swapping ? 2 : step === "verify" ? 1 : 0;

  let percent;
  if (!restartRequired && step === "download" && install?.total > 0) {
    percent = Math.min(100, Math.max(0, Math.floor((install.received * 100) / install.total)));
  }

  let heading;
  if (restartRequired) {
    const version = install?.version || "";
    heading = version
      ? `Marasi ${version} installed on ${connectionName}`
      : `Update installed on ${connectionName}`;
  } else if (swapping) {
    heading = `Replacing executable on ${connectionName}…`;
  } else if (step === "verify") {
    heading = "Verifying signature and checksum…";
  } else if (percent !== undefined) {
    heading = `Downloading on ${connectionName}… ${percent}%`;
  } else {
    heading = `Downloading on ${connectionName}…`;
  }

  return {
    steps: SERVICE_UPDATE_STEPS,
    stepIndex,
    percent,
    cancellable: Boolean(!restartRequired && install?.state === "running" && !swapping),
    heading,
  };
}

/**
 * Strict precedence for the single contextual slot below the action bar
 * (at most one card renders at a time).
 */
export function contextualSlotKind({
  isActive,
  phase,
  connectionState,
  updateState,
  showRestartConfirm,
  showStopConfirm,
  isCLIMissing,
  isOutdated,
  stopErrorText,
}) {
  if (showRestartConfirm) return "restart-confirm";
  if (showStopConfirm) return "stop-confirm";
  if (isActive && phase === "auth-failed") return "auth-failed";
  if (isCLIMissing) return "cli-missing";
  if (isOutdated) return "outdated";
  if (isActive && phase === "stopped") return "stopped";
  if (isActive && phase === "failed") return "failed";

  const connectedUpdates = isActive && phase === "connected" && supportsServiceUpdates(connectionState, updateState);
  if (connectedUpdates && isUpdateInstalling(updateState)) return "installing";
  if (connectedUpdates && isUpdateRestartRequired(connectionState, updateState)) return "restart-required";

  if (stopErrorText) return "stop-error";
  if (connectedUpdates && updateState?.error) return "install-error";
  if (isActive && connectionState?.restartError) return "restart-error";
  if (connectedUpdates && updateState?.available) return "available";
  if (isActive && connectionState?.apiWarning) return "api-warning";
  return null;
}

/** Clean toast for an explicit `Check update` that found the service up to date. */
export function serviceUpdateCheckToast(result, connectionName) {
  if (!result?.ok || result.kind !== "up-to-date") return null;
  return {
    message: result.channel
      ? `${connectionName} is on the latest ${result.channel} build`
      : `${connectionName} is up to date`,
    background: "variant-filled-success",
  };
}

/** Formats available service update release notes (stripping nightly metadata headers). */
export function formatServiceNotes(available) {
  if (!available?.notes) return "";
  return available.channel === "nightly" ? nightlyNotes(available.notes) : available.notes.trim();
}
