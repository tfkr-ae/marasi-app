// App-bound desktop local Marasi CLI store: loads LocateCLI, CarriedCLI, and
// BuildInfo on desktop, persists carried-CLI dismissals per version, and keeps
// located CLI info fresh across local connection restarts. Never runs on mobile.
import { get } from "svelte/store";
import {
  BrowseCLIPath,
  CarriedCLI,
  ClearCLIPath,
  GetBuildInfo,
  InstallCarriedCLI,
  LocateCLI,
  RestartLocalInstance,
  UseCLIPath,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { mobile } from "../lib/platform.js";
import { connectionStore } from "./connectionStore.js";
import { createLocalCLIStore, followLocalConnection } from "./createLocalCLIStore.js";

export const localCLIStore = createLocalCLIStore({
  locateCLI: () => LocateCLI(),
  carriedCLI: () => CarriedCLI(),
  getBuildInfo: () => GetBuildInfo(),
  browseCLIPath: () => BrowseCLIPath(),
  useCLIPath: (path) => UseCLIPath(path),
  clearCLIPath: () => ClearCLIPath(),
  installCarriedCLI: () => InstallCarriedCLI(),
  restartLocalInstance: (id) => RestartLocalInstance(id),
});

followLocalConnection(connectionStore, localCLIStore, { isMobile: () => get(mobile) });
