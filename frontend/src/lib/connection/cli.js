// How the Marasi CLI setup (CLISetup.svelte, in the Connections modal) and
// Settings → Marasi CLI (CLISettings.svelte) read Go's CLI results
// (cli_locate.go, cli_install.go).
import { codeIDs } from "../errorCodes.js";

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

const sources = { custom: "Custom path", installed: "Installed by Marasi", path: "PATH" };

/** Where the CLI was found. */
export const cliSourceLabel = (source) => sources[source] ?? source;
