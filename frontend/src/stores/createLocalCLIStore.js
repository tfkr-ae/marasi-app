// Desktop local Marasi CLI store factory: tracks LocateCLI, CarriedCLI,
// BuildInfo.Channel, per-version carried-CLI dismissal persistence, path edits,
// and offline carried-CLI Install & restart. Completely inactive on mobile.
import { writable } from "svelte/store";
import {
  applyCarriedCLI,
  readDismissedCarriedVersion,
  writeDismissedCarriedVersion,
} from "../lib/connection/carried.js";

export function createLocalCLIStore(api, storage = undefined) {
  const store = writable({
    loaded: false,
    cli: null,
    carried: null,
    appChannel: "",
    dismissedVersion: readDismissedCarriedVersion(storage),
    installing: false,
    changingPath: false,
  });

  const patch = (next) => store.update((s) => ({ ...s, ...next }));

  async function load() {
    const [cli, carried, build] = await Promise.all([
      api.locateCLI?.().catch(() => null) ?? null,
      api.carriedCLI?.().catch(() => null) ?? null,
      api.getBuildInfo?.().catch(() => null) ?? null,
    ]);
    patch({
      loaded: true,
      cli,
      carried,
      appChannel: build?.Channel ?? "",
    });
  }

  async function refreshCLI() {
    if (!api.locateCLI) return null;
    try {
      const cli = await api.locateCLI();
      patch({ cli });
      return cli;
    } catch {
      return null;
    }
  }

  function setCLI(cli) {
    if (cli) patch({ cli });
  }

  async function browseAndUsePath() {
    if (!api.browseCLIPath || !api.useCLIPath) return null;
    patch({ changingPath: true });
    try {
      const chosen = await api.browseCLIPath();
      if (!chosen) return null;
      const info = await api.useCLIPath(chosen);
      patch({ cli: info });
      return info;
    } finally {
      patch({ changingPath: false });
    }
  }

  async function clearPath() {
    if (!api.clearCLIPath) return null;
    patch({ changingPath: true });
    try {
      const info = await api.clearCLIPath();
      patch({ cli: info });
      return info;
    } finally {
      patch({ changingPath: false });
    }
  }

  function dismissCarried(version) {
    if (!version) return;
    writeDismissedCarriedVersion(version, storage);
    patch({ dismissedVersion: version });
  }

  async function installCarried({
    connectionState = null,
    connectionId = "local",
    isActive = true,
    instanceRunning = false,
    restartService = null,
    restartLocal = null,
    retryConnection = null,
  } = {}) {
    patch({ installing: true });
    try {
      return await applyCarriedCLI({
        installCarried: () => api.installCarriedCLI(),
        refreshCLI: async (cli) => {
          if (cli?.found) patch({ cli });
          else await refreshCLI();
        },
        connectionState,
        connectionId,
        isActive,
        instanceRunning,
        restartService,
        restartLocal: restartLocal ?? ((id) => api.restartLocalInstance(id)),
        retryConnection,
      });
    } finally {
      patch({ installing: false });
    }
  }

  async function setWhenQuitting(value) {
    if (!api.setWhenQuitting) return null;
    return await api.setWhenQuitting(value);
  }

  return {
    subscribe: store.subscribe,
    load,
    refreshCLI,
    setCLI,
    browseAndUsePath,
    clearPath,
    dismissCarried,
    installCarried,
    setWhenQuitting,
  };
}

/**
 * Keeps the located local CLI info fresh on desktop whenever a local connection
 * enters `connected` or reconnects onto a new `runId` (for instance after a
 * service self-update replaces the binary on disk).
 */
export function followLocalConnection(connectionStore, localCLIStore, { isMobile = () => false } = {}) {
  let prevId = null;
  let prevPhase = null;
  let prevRunId = null;

  return connectionStore.subscribe((state) => {
    const id = state?.connection?.id ?? null;
    const kind = state?.connection?.kind ?? null;
    const phase = state?.phase ?? null;
    const runId = state?.runId ?? null;

    const isLocalConnected = !isMobile() && kind === "local" && phase === "connected";
    const switchedToLocal = isLocalConnected && prevId !== null && id !== prevId;
    const enteredConnected = isLocalConnected && prevPhase !== null && prevPhase !== "connected";
    const newRun = isLocalConnected && Boolean(prevRunId && runId && runId !== prevRunId);

    prevId = id;
    prevPhase = phase;
    prevRunId = runId;

    if (switchedToLocal || enteredConnected || newRun) {
      localCLIStore.refreshCLI();
    }
  });
}
