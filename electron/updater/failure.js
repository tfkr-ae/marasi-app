// What an install failed at (v1's UpdateFailureKind and installError), so
// the panel can say plainly what failed. The kinds and steps are the strings
// frontend/src/lib/updates.js reads.
//
// Kinds: network, no-build, signature, checksum, team, permissions, install.
// Steps (InstallStep): download, verify, install.

/** An install step that failed with `kind`. */
export function failed(kind, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { kind, beforeDownload: false });
}

/** Marks err as found before anything downloaded, by the check that this build can install updates. */
export function foundBeforeDownload(err) {
  err.beforeDownload = true;
  return err;
}

/**
 * Keeps an installer's own failure kind, and otherwise calls a permission
 * error a permissions failure and anything else an install failure.
 */
export function asInstallError(err, doing) {
  if (err?.kind) return err;
  const kind = err?.code === "EACCES" || err?.code === "EPERM" ? "permissions" : "install";
  return failed(kind, `${doing}: ${err?.message ?? err}`, err);
}

/**
 * The step a failed install is reported at. A network, signature, checksum
 * or team failure stops at its own step wherever it is found; a build that
 * can't install updates, found before anything downloads, stops at install;
 * anything else stops at the step running when it happened.
 */
export function failureStep(kind, beforeDownload, running) {
  if (kind === "network") return "download";
  if (kind === "signature" || kind === "checksum" || kind === "team") return "verify";
  if (beforeDownload) return "install";
  return running;
}

/** A download the researcher cancelled. */
export class Cancelled extends Error {
  constructor() {
    super("the download was cancelled");
  }
}
