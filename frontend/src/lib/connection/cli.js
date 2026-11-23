// How the Marasi CLI setup (CLISetup.svelte, in the Connections modal) and
// Settings → Updates (CLISettings.svelte) read Go's CLI results
// (cli_locate.go, cli_install.go).
import { codeCause, codeIDs } from "../errorCodes.js";

/** Whether a connection error is the CLI missing (`cli_missing`). */
export const cliMissing = (error) => codeIDs(error, "cli_missing") !== null;

/**
 * Whether to open the Connections modal with the CLI setup: the connection
 * failed for want of the CLI, and the setup hasn't opened for this failure.
 */
export const shouldOfferCLISetup = (state, offered) =>
  !offered && state.phase === "failed" && cliMissing(state.error);

/** The toast for an InstallCLI or CheckForCLIUpdate result. */
export function cliResultText(result) {
  switch (result.outcome) {
    case "installed":
      return `Marasi CLI ${result.version} installed`;
    case "up-to-date":
      return "Marasi CLI is up to date";
    case "dev":
      return "Development build, not updated";
    default:
      return result.failure?.reason ?? "Install failed";
  }
}

/**
 * Go's event with the result of the CLI update check that runs after Install
 * placed the carried CLI (a CLIInstall, as CheckForCLIUpdate returns).
 */
export const CLI_UPDATE_CHECKED_EVENT = "cli-update-checked";

/**
 * The toast for that check: the newer CLI it installed, or null when it left
 * the carried CLI (up to date, or a failure, which Go logs).
 */
export const cliUpdateCheckedNotice = (result) =>
  result?.outcome === "installed" ? cliResultText(result) : null;

/**
 * Whether Settings offers to install the CLI this build carries (Go's
 * CarriedCLI) over the one found (LocateCLI): the build carries one and it
 * isn't the installed version and channel.
 */
export const offersCarriedCLI = (carried, cli) =>
  Boolean(carried?.available && cli?.found && (carried.version !== cli.version || carried.channel !== cli.channel));

const sources = { custom: "Custom path", installed: "Installed by Marasi", path: "PATH" };

/** Where the CLI was found. */
export const cliSourceLabel = (source) => sources[source] ?? source;

const progressSteps = {
  download: "Downloading…",
  verify: "Verifying…",
  extract: "Extracting…",
  install: "Installing…",
};

/**
 * What a running install says, from Go's latest cli-install-progress
 * ({step, received, total}); before the first event it is downloading.
 */
export const cliProgressText = (progress) => progressSteps[progress?.step] ?? progressSteps.download;

/**
 * The download's progress bar value (0–100), or undefined, an indeterminate
 * bar, when the size is unknown or the install is past the download.
 */
export function cliProgressPercent(progress) {
  if (progress?.step !== "download" || !(progress.total > 0)) return undefined;
  return Math.min(100, Math.round((progress.received / progress.total) * 100));
}

/**
 * The version an outdated local instance runs (`instance_outdated`, from
 * Go's ConnectLocal), or null when the error isn't that.
 */
export function outdatedVersion(error) {
  const cause = codeCause(error, "instance_outdated");
  if (cause === null) return null;
  return /^Marasi (.+) is running, older than/.exec(cause)?.[1] ?? "";
}

/**
 * Installs a CLI (`install`, Go's CheckForCLIUpdate or InstallCarriedCLI),
 * then restarts the local instance with it (`restart`, Go's
 * RestartLocalInstance), so the instance runs the CLI just installed. A
 * current CLI still restarts, since the instance may run another build. A
 * null `restart` (no running local instance) only installs. Resolves to
 * `{ok, text}` for the toast or the problem.
 */
export async function installThenRestart({ install, restart }) {
  const result = await install();
  if (result.outcome === "failed") return { ok: false, text: cliResultText(result) };
  if (restart) await restart();
  return { ok: true, text: cliResultText(result) };
}

/**
 * Update CLI, for a local instance at an API level the app doesn't support:
 * installs the CLI channel's release (`checkForUpdate`, Go's
 * CheckForCLIUpdate) and restarts the local instance with it
 * (installThenRestart). Marasi doesn't publish its releases' API levels, so
 * the install takes the channel's latest.
 */
export const updateCLI = ({ checkForUpdate, restart }) => installThenRestart({ install: checkForUpdate, restart });

/**
 * Whether Install from embedded restarts the active connection: it is a
 * local instance that isn't stopped. A remote runs its own Marasi.
 */
export const restartsAfterCLIInstall = (state) => state?.connection?.kind === "local" && state.phase !== "stopped";
