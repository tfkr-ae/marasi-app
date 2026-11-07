// The connected service's own update: the Marasi binary the service runs
// checking for and installing a newer build of itself (`marasi update`,
// another client, or its own check), as its update.* events report. This
// is not the app's update (updateStore.js) nor the app installing the CLI
// (cli_install.go). Settings → Marasi CLI shows it; available, installed
// and failed also toast. It follows the active connection: a switch clears it.
import { writable } from "svelte/store";

/** The events this store follows. */
export const SERVICE_UPDATE_EVENTS = ["update.available", "update.progress", "update.installed", "update.failed"];

const initial = () => ({
  // The newest build the service found: {version, channel, notes, page}, or null.
  available: null,
  // The last install: {state: "running", version, step, received, total},
  // {state: "installed", version, installPath} or {state: "failed",
  // version, step, message}, or null.
  install: null,
});

export function createServiceUpdateStore() {
  const store = writable(initial());
  const set = (patch) => store.update((s) => ({ ...s, ...patch }));
  const handlers = {
    "update.available": (e) => set({ available: { version: e.version, channel: e.channel, notes: e.notes ?? "", page: e.page ?? "" } }),
    "update.progress": (e) =>
      set({ install: { state: "running", version: e.version, step: e.step, received: e.received ?? 0, total: e.total ?? 0 } }),
    "update.installed": (e) => set({ install: { state: "installed", version: e.version, installPath: e.install_path ?? "" } }),
    "update.failed": (e) => set({ install: { state: "failed", version: e.version, step: e.step ?? "", message: e.message ?? "" } }),
  };
  return {
    subscribe: store.subscribe,
    /** Takes the service's `name` event with its data. */
    onEvent: (name, data) => handlers[name]?.(data ?? {}),
    /** Forgets the last service's update. */
    clear: () => store.set(initial()),
  };
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
  if (event === "update.failed") return { message: `Marasi update failed on ${name}: ${data.message}`, background: "variant-filled-error" };
  return null;
}
