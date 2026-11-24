// How the Marasi CLI setup (CLISetup.svelte) and Local's Connection details
// (ConnectionDetail.svelte) read Go's CLI results (cli_locate.go,
// cli_install.go, cli_carried.go).
import { codeCause, codeIDs } from "../errorCodes.js";

/** Whether a connection error is the CLI missing (`cli_missing`). */
export const cliMissing = (error) => codeIDs(error, "cli_missing") !== null;

/**
 * Whether to open the Connections modal with the CLI setup: the connection
 * failed for want of the CLI, and the setup hasn't opened for this failure.
 */
export const shouldOfferCLISetup = (state, offered) =>
  !offered && state.phase === "failed" && cliMissing(state.error);

/** The toast for an InstallCLI or InstallCarriedCLI result. */
export function cliResultText(result) {
  switch (result.outcome) {
    case "installed":
      return `Marasi CLI ${result.version} installed`;
    case "up-to-date":
      return "Marasi CLI is up to date";
    default:
      return result.failure?.reason ?? "Install failed";
  }
}

/**
 * Whether Connections offers to install the CLI this build carries (Go's
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
