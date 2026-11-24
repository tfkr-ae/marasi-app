// The connected service's own update: the Marasi binary the service runs
// checking for, installing, cancelling, changing channel, and reinstalling via
// the control API (/update, /update/check, /update/install, DELETE /update/install,
// PUT /update/channel, POST /update/reinstall) and live update.* SSE events.
// This is not the app's update (updateStore.js) nor the desktop app's carried
// CLI. It follows the active connection: switching connections clears it
// immediately and supersedes any in-flight calls.
import { get, writable } from "svelte/store";
import { isSuperseded } from "../lib/service/errors.js";

/** The events this store follows. */
export const SERVICE_UPDATE_EVENTS = ["update.available", "update.progress", "update.installed", "update.failed"];

const isUpdatesUnavailable = (err) =>
  err?.status === 404 || err?.status === 501 || err?.code === "updates_unavailable";

const isDevBuildError = (err) => err?.code === "development_build";

function normalizeAvailable(raw) {
  if (!raw || !raw.version) return null;
  return {
    version: raw.version,
    channel: raw.channel ?? "",
    published: raw.published ?? null,
    notes: raw.notes ?? "",
    page: raw.page ?? "",
  };
}

function normalizeInstallFromSnapshot(raw, installPath) {
  if (!raw || !raw.state || raw.state === "idle") return { install: null, error: null };
  if (raw.state === "running") {
    return {
      install: {
        state: "running",
        version: raw.version ?? "",
        step: raw.step || "download",
        received: raw.received ?? 0,
        total: raw.total ?? 0,
        joined: true,
      },
      error: null,
    };
  }
  if (raw.state === "installed") {
    return {
      install: {
        state: "installed",
        version: raw.version ?? "",
        installPath: installPath ?? "",
      },
      error: null,
    };
  }
  if (raw.state === "failed") {
    const err = raw.error ?? {};
    if (err.kind === "cancelled") return { install: null, error: null };
    const failed = {
      state: "failed",
      version: raw.version ?? "",
      kind: err.kind ?? "",
      step: err.step ?? raw.step ?? "",
      message: err.message ?? "",
      page: err.page ?? "",
      installPath: err.kind === "permissions" ? (installPath ?? "") : "",
    };
    return {
      install: failed,
      error: {
        code: err.kind === "permissions" ? "install_path_not_writable" : (err.kind || "install_failed"),
        kind: failed.kind,
        step: failed.step,
        message: failed.message || "Update failed",
        page: failed.page,
        installPath: failed.installPath,
      },
    };
  }
  return { install: null, error: null };
}

const initial = () => ({
  loaded: false,
  supported: true,
  development: false,
  installed: null,
  channel: null,
  installPath: "",
  restartRequired: false,
  // Bumped whenever a live install completes so a dismissed restart banner resurfaces.
  installedSeq: 0,
  // The newest build the service found: {version, channel, published, notes, page}, or null.
  available: null,
  // The running or last install: {state: "running", version, step, received, total, joined},
  // {state: "installed", version, installPath} or {state: "failed", version, kind, step, message, page, installPath}, or null.
  install: null,
  checking: false,
  switchingChannel: false,
  startingInstall: false,
  cancelling: false,
  checkResult: null,
  error: null,
});

export function createServiceUpdateStore(api = null) {
  const store = writable(initial());
  let epoch = 0;

  const set = (patch) => store.update((s) => ({ ...s, ...patch }));

  function applySnapshot(body, { preserveRunning = false } = {}) {
    const prev = get(store);
    const installPath = body?.install_path ?? prev.installPath ?? "";
    const available = normalizeAvailable(body?.available);
    const development = Boolean(body?.development);
    const installed = body?.installed
      ? { version: body.installed.version ?? "", channel: body.installed.channel ?? null }
      : prev.installed;
    const channel = body?.channel ?? body?.installed?.channel ?? null;
    const parsed = normalizeInstallFromSnapshot(body?.install, installPath);
    const restartRequired = Boolean(body?.restart_required) || parsed.install?.state === "installed";
    const completedRunningInstall = prev.install?.state === "running" && restartRequired;

    let install = parsed.install;
    let error = restartRequired ? null : parsed.error;
    if (preserveRunning && !install && prev.install?.state === "running") {
      install = prev.install;
    }

    store.update((s) => ({
      ...s,
      loaded: true,
      supported: true,
      development,
      installed,
      channel,
      installPath,
      restartRequired,
      installedSeq: completedRunningInstall ? s.installedSeq + 1 : s.installedSeq,
      available: restartRequired ? null : available,
      install,
      error,
    }));
  }

  function boundCall() {
    const myEpoch = epoch;
    const link = api?.bind?.();
    const live = () => myEpoch === epoch && (link?.live?.() ?? true);
    return { link, live };
  }

  const handlers = {
    "update.available": (e) =>
      store.update((s) => ({
        ...s,
        available: normalizeAvailable(e),
      })),
    "update.progress": (e) =>
      store.update((s) => ({
        ...s,
        startingInstall: false,
        restartRequired: false,
        error: null,
        install: {
          state: "running",
          version: e.version ?? s.install?.version ?? s.available?.version ?? "",
          step: e.step || "download",
          received: e.received ?? 0,
          total: e.total ?? 0,
          joined: Boolean(s.install?.joined),
        },
      })),
    "update.installed": (e) =>
      store.update((s) => ({
        ...s,
        startingInstall: false,
        cancelling: false,
        restartRequired: true,
        installedSeq: s.installedSeq + 1,
        available: null,
        error: null,
        installPath: e.install_path ?? s.installPath,
        install: {
          state: "installed",
          version: e.version ?? s.install?.version ?? s.available?.version ?? "",
          installPath: e.install_path ?? s.installPath ?? "",
        },
      })),
    "update.failed": (e) =>
      store.update((s) => {
        if (e.kind === "cancelled") {
          return {
            ...s,
            startingInstall: false,
            cancelling: false,
            install: null,
            error: null,
          };
        }
        const installPath = e.install_path || (e.kind === "permissions" ? s.installPath : "") || "";
        const page = e.page || s.available?.page || "";
        const failed = {
          state: "failed",
          version: e.version ?? s.install?.version ?? s.available?.version ?? "",
          kind: e.kind ?? "",
          step: e.step ?? "",
          message: e.message ?? "",
          page,
          installPath,
        };
        return {
          ...s,
          startingInstall: false,
          cancelling: false,
          install: failed,
          error: {
            code: e.kind === "permissions" ? "install_path_not_writable" : (e.kind || "install_failed"),
            kind: failed.kind,
            step: failed.step,
            message: failed.message || "Update failed",
            page,
            installPath,
          },
        };
      }),
  };

  async function load() {
    if (!api?.getUpdate) return { ok: false };
    const { link, live } = boundCall();
    try {
      const body = await api.getUpdate(link);
      if (!live()) return { ok: false, superseded: true };
      applySnapshot(body);
      return { ok: true, body };
    } catch (err) {
      if (isSuperseded(err) || !live()) return { ok: false, superseded: true };
      if (isUpdatesUnavailable(err)) {
        set({ loaded: true, supported: false, error: null });
        return { ok: false, unsupported: true };
      }
      if (isDevBuildError(err)) {
        set({ loaded: true, development: true, error: null });
        return { ok: false, development: true };
      }
      return { ok: false, error: err };
    }
  }

  async function check() {
    if (!api?.checkUpdate) return { ok: false };
    const { link, live } = boundCall();
    set({ checking: true, checkResult: null, error: null });
    try {
      const body = await api.checkUpdate(link);
      if (!live()) return { ok: false, superseded: true };
      applySnapshot(body, { preserveRunning: true });
      const checkError = body?.last_check?.error || "";
      if (body?.development) {
        set({ checking: false, checkResult: null, error: null });
        return { ok: true, kind: "development" };
      }
      if (checkError) {
        const error = {
          code: "check_failed",
          kind: "network",
          step: "",
          message: checkError,
          page: "",
          installPath: "",
        };
        set({ checking: false, checkResult: { kind: "error", message: checkError }, error });
        return { ok: false, kind: "error", error };
      }
      const next = get(store);
      if (next.restartRequired) {
        const checkResult = { kind: "restart-required", version: next.install?.version ?? "" };
        set({ checking: false, checkResult });
        return { ok: true, ...checkResult };
      }
      if (next.available) {
        const checkResult = {
          kind: "available",
          version: next.available.version,
          channel: next.available.channel,
        };
        set({ checking: false, checkResult });
        return { ok: true, ...checkResult };
      }
      const checkResult = {
        kind: "up-to-date",
        version: next.installed?.version ?? "",
        channel: next.channel ?? null,
      };
      set({ checking: false, checkResult });
      return { ok: true, ...checkResult };
    } catch (err) {
      if (isSuperseded(err) || !live()) return { ok: false, superseded: true };
      if (isUpdatesUnavailable(err)) {
        set({ loaded: true, supported: false, checking: false, checkResult: null, error: null });
        return { ok: false, unsupported: true };
      }
      if (isDevBuildError(err)) {
        set({ loaded: true, development: true, checking: false, checkResult: null, error: null });
        return { ok: false, development: true };
      }
      const message = err?.body?.message || String(err?.message ?? err);
      const error = {
        code: err?.code || "check_failed",
        kind: "",
        step: "",
        message,
        page: err?.body?.page ?? "",
        installPath: err?.body?.install_path ?? "",
      };
      set({ checking: false, checkResult: { kind: "error", message }, error });
      return { ok: false, kind: "error", error };
    }
  }

  const stepRank = { download: 0, verify: 1, install: 2, swap: 2 };

  async function startInstall(run, { reinstall: isReinstall = false } = {}) {
    if (!run) return { ok: false };
    const { link, live } = boundCall();
    set({ startingInstall: true, checkResult: null, error: null });
    try {
      const body = await run(link);
      if (!live()) return { ok: false, superseded: true };
      const joined = Boolean(body?.joined);
      store.update((s) => {
        const installPath = body?.install_path || s.installPath;
        const completedDuringCall = isReinstall
          ? !s.startingInstall && s.install?.state === "installed"
          : s.restartRequired || s.install?.state === "installed";
        if (completedDuringCall) {
          return { ...s, startingInstall: false, installPath };
        }
        const incoming = body?.install;
        const incomingStep = incoming?.step || "download";
        const incomingReceived = incoming?.received ?? 0;
        const incomingTotal = incoming?.total ?? 0;
        // Preserve more advanced SSE progress if it arrived before the 202 body.
        const current = s.install?.state === "running" ? s.install : null;
        const keepCurrent =
          current &&
          ((stepRank[current.step] ?? 0) > (stepRank[incomingStep] ?? 0) ||
            (current.step === incomingStep && current.received > incomingReceived));
        const fallbackVersion = isReinstall ? "" : (s.available?.version || "");
        const nextInstall = keepCurrent
          ? { ...current, joined: current.joined || joined }
          : {
              state: "running",
              version: incoming?.version || fallbackVersion,
              step: incomingStep,
              received: incomingReceived,
              total: incomingTotal,
              joined,
            };
        return {
          ...s,
          startingInstall: false,
          restartRequired: false,
          installPath,
          error: null,
          install: nextInstall,
        };
      });
      return { ok: true, joined, body };
    } catch (err) {
      if (isSuperseded(err) || !live()) return { ok: false, superseded: true };
      if (isUpdatesUnavailable(err)) {
        set({ loaded: true, supported: false, startingInstall: false, error: null });
        return { ok: false, unsupported: true };
      }
      if (isDevBuildError(err)) {
        set({ loaded: true, development: true, startingInstall: false, error: null });
        return { ok: false, development: true };
      }
      if (!isReinstall && err?.code === "already_installed") {
        store.update((s) => ({
          ...s,
          startingInstall: false,
          restartRequired: true,
          available: null,
          error: null,
          install:
            s.install?.state === "installed"
              ? s.install
              : { state: "installed", version: s.available?.version ?? "", installPath: s.installPath },
        }));
        return { ok: true, alreadyInstalled: true };
      }
      if (err?.code === "update_in_progress") {
        if (api.getUpdate) {
          try {
            const snap = await api.getUpdate(link);
            if (!live()) return { ok: false, superseded: true };
            if (snap?.install?.state === "running" || snap?.restart_required) {
              applySnapshot(snap);
              set({ startingInstall: false });
              return { ok: true, joined: true };
            }
          } catch (snapErr) {
            if (isSuperseded(snapErr) || !live()) return { ok: false, superseded: true };
          }
        }
        if (err?.body?.instance) {
          const message = err.body.message || `Another instance (${err.body.instance}) is installing an update`;
          const error = { code: "update_in_progress", kind: "", step: "", message, page: "", installPath: "" };
          set({ startingInstall: false, error });
          return { ok: false, error };
        }
        store.update((s) => ({
          ...s,
          startingInstall: false,
          restartRequired: false,
          error: null,
          install: {
            state: "running",
            version: isReinstall ? "" : (s.available?.version ?? ""),
            step: "download",
            received: 0,
            total: 0,
            joined: true,
          },
        }));
        return { ok: true, joined: true };
      }
      if (!isReinstall && err?.code === "no_update") {
        store.update((s) => ({
          ...s,
          startingInstall: false,
          available: null,
          error: null,
          checkResult: { kind: "up-to-date", version: s.installed?.version ?? "", channel: s.channel },
        }));
        return { ok: true, upToDate: true };
      }
      const prev = get(store);
      const isPermissions = err?.code === "install_path_not_writable";
      const installPath = err?.body?.install_path || (isPermissions ? prev.installPath : "") || "";
      const page = err?.body?.page || (isReinstall ? "" : (prev.available?.page || ""));
      const message = err?.body?.message || String(err?.message ?? err);
      const error = {
        code: err?.code || "install_failed",
        kind: isPermissions ? "permissions" : "",
        step: isPermissions ? "install" : "",
        message,
        page,
        installPath,
      };
      if (isReinstall) {
        set({ startingInstall: false, error });
      } else {
        set({
          startingInstall: false,
          install: {
            state: "failed",
            version: prev.available?.version ?? "",
            kind: error.kind,
            step: error.step,
            message,
            page,
            installPath,
          },
          error,
        });
      }
      return { ok: false, error };
    }
  }

  const install = () => startInstall(api?.installUpdate, { reinstall: false });
  const reinstall = () => startInstall(api?.reinstallUpdate, { reinstall: true });

  async function cancel() {
    if (!api?.cancelInstall) return { ok: false };
    const { link, live } = boundCall();
    set({ cancelling: true });
    try {
      await api.cancelInstall(link);
      if (!live()) return { ok: false, superseded: true };
      set({ cancelling: false, startingInstall: false, install: null, error: null });
      return { ok: true };
    } catch (err) {
      if (isSuperseded(err) || !live()) return { ok: false, superseded: true };
      if (isUpdatesUnavailable(err)) {
        set({ loaded: true, supported: false, cancelling: false, error: null });
        return { ok: false, unsupported: true };
      }
      if (err?.code === "install_not_cancellable" || err?.code === "no_install") {
        set({ cancelling: false });
        if (api.getUpdate) {
          try {
            const snap = await api.getUpdate(link);
            if (!live()) return { ok: false, superseded: true };
            applySnapshot(snap);
          } catch (snapErr) {
            if (isSuperseded(snapErr) || !live()) return { ok: false, superseded: true };
          }
        }
        return {
          ok: false,
          notCancellable: err?.code === "install_not_cancellable",
          noInstall: err?.code === "no_install",
        };
      }
      const message = err?.body?.message || String(err?.message ?? err);
      const error = { code: err?.code || "cancel_failed", kind: "", step: "", message, page: "", installPath: "" };
      set({ cancelling: false, error });
      return { ok: false, error };
    }
  }

  async function setChannel(channel) {
    if (!api?.setChannel) return { ok: false };
    const { link, live } = boundCall();
    set({ switchingChannel: true, checkResult: null, error: null });
    try {
      const body = await api.setChannel(channel, link);
      if (!live()) return { ok: false, superseded: true };
      applySnapshot(body, { preserveRunning: true });
      const next = get(store);
      set({ switchingChannel: false });
      return { ok: true, channel: next.channel, available: next.available, body };
    } catch (err) {
      if (isSuperseded(err) || !live()) return { ok: false, superseded: true };
      if (isUpdatesUnavailable(err)) {
        set({ loaded: true, supported: false, switchingChannel: false, error: null });
        return { ok: false, unsupported: true };
      }
      if (isDevBuildError(err)) {
        set({ loaded: true, development: true, switchingChannel: false, error: null });
        return { ok: false, development: true };
      }
      const message = err?.body?.message || String(err?.message ?? err);
      const error = {
        code: err?.code || "channel_failed",
        kind: "",
        step: "",
        message,
        page: err?.body?.page ?? "",
        installPath: err?.body?.install_path ?? "",
      };
      set({ switchingChannel: false, error });
      return { ok: false, error };
    }
  }

  return {
    subscribe: store.subscribe,
    load,
    check,
    setChannel,
    install,
    reinstall,
    cancel,
    /** Takes the service's `name` event with its data. */
    onEvent: (name, data) => handlers[name]?.(data ?? {}),
    /** Clears any displayed update error without dropping an available update. */
    dismissError: () => set({ error: null }),
    /** Forgets the last service's update and supersedes in-flight calls. */
    clear: () => {
      epoch++;
      store.set(initial());
    },
  };
}

/**
 * Keeps `updateStore` synced with `connectionStore`: clears immediately on
 * connection switch, new session, stop, or run change, and fetches GET /update
 * whenever a connection enters `connected` or reconnects onto a new run.
 */
export function followConnection(connectionStore, updateStore) {
  let prevId = null;
  let prevSession = null;
  let prevPhase = null;
  let prevRunId = null;

  return connectionStore.subscribe((state) => {
    const id = state.connection?.id ?? null;
    const session = state.session ?? 0;
    const phase = state.phase;
    const runId = state.runId ?? null;

    const switched = prevId !== null && (id !== prevId || session !== prevSession);
    const stopped = phase === "stopped" && prevPhase !== "stopped";
    const newRun = Boolean(prevRunId && runId && runId !== prevRunId);

    if (switched || stopped || newRun) {
      updateStore.clear();
    }

    const enteredConnected = phase === "connected" && (prevPhase !== "connected" || switched || newRun);
    const runChangedWhileConnected = phase === "connected" && prevPhase === "connected" && runId !== prevRunId && runId !== null;

    prevId = id;
    prevSession = session;
    prevPhase = phase;
    prevRunId = runId;

    if (enteredConnected || runChangedWhileConnected) {
      updateStore.load();
    }
  });
}

/** The one line Settings shows, or null when there is nothing to say. */
export function serviceUpdateLine({ available, install }) {
  if (install?.state === "running") {
    const pct = install.total > 0 ? ` ${Math.floor((install.received / install.total) * 100)}%` : "";
    return `Installing ${install.version}: ${install.step}${pct}`;
  }
  if (install?.state === "installed") return `${install.version} installed. Restart the service to run it.`;
  if (install?.state === "failed") return `${install.version} not installed: ${install.message}`;
  if (available) return `${available.version} available (${available.channel})`;
  return null;
}

/** The short toast for the event on the connection named `name`, or null. */
export function serviceUpdateToast(event, data, name) {
  if (event === "update.available") return { message: `Marasi ${data.version} available on ${name}`, background: "variant-filled-primary" };
  if (event === "update.installed") return { message: `Marasi ${data.version} installed on ${name}`, background: "variant-filled-success" };
  if (event === "update.failed") {
    if (data?.kind === "cancelled") return null;
    return { message: `Marasi update failed on ${name}: ${data.message}`, background: "variant-filled-error" };
  }
  return null;
}
