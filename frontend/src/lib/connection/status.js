// How a connection's phase reads in the rail tile, the Connections modal and
// Settings → Connection. Phases are the connection store's
// (stores/createConnectionStore.js); a new phase adds its label and tone here.

const labels = {
  idle: "Not connected",
  starting: "Starting",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  "project-changed": "Project changed",
  failed: "Couldn't connect",
  "auth-failed": "Password refused",
  stopped: "Stopped",
  unpaired: "Not paired",
};

/** The status text for `phase`. */
export const phaseLabel = (phase) => labels[phase] ?? phase;

const amber = ["starting", "connecting", "reconnecting", "project-changed"];

/** The status dot's colour class for `phase`. */
export function phaseTone(phase) {
  if (phase === "connected") return "bg-success-500";
  if (amber.includes(phase)) return "bg-warning-500";
  if (phase === "idle" || phase === "stopped" || phase === "unpaired") return "bg-surface-400";
  return "bg-error-500";
}

/** Where a connection's service runs, under its name. */
export function whereText(connection, instance) {
  if (connection.kind === "local") return instance ? `This machine · instance ${instance}` : "This machine";
  return connection.url?.replace(/^https?:\/\//, "") ?? "";
}

/** Settings → Connection's hint: the active connection and its status. */
export const statusHint = (state) => `${state.connection.name} · ${phaseLabel(state.phase)}`;

/**
 * Whether the native file picker shows: a remote's projects live on its
 * host, so they open from the service's list or a typed path.
 */
export const filePickerShown = (connection) => connection.kind === "local";

/**
 * Whether the pages stay visible but dimmed and inert (+layout.svelte): the
 * service has another project open than they show, or Marasi is stopped.
 */
export const pagesHeld = (phase) => phase === "project-changed" || phase === "stopped";

/**
 * What the start screen says while the app reaches the active connection,
 * before the first project loads: a remote or a named local connection by
 * its name, Local as Marasi.
 */
export function startupText({ phase, connection }) {
  const reaching = reachingText({ phase, connection });
  if (reaching) return reaching;
  const text = {
    idle: "Starting…",
    connected: "Loading project…",
    failed: `Couldn't reach ${startupName(connection)}`,
    "auth-failed": phaseLabel("auth-failed"),
    unpaired: "Pair with Marasi on your computer to start",
  };
  return text[phase] ?? null;
}

// A remote or a named local connection by its name, Local as Marasi.
const isNamed = (connection) => connection.kind === "remote" || connection.id !== "local";
const startupName = (connection) => (isNamed(connection) ? connection.name : "Marasi");

/**
 * What the start screen and the switch banner say while the app reaches a
 * connection (starting or connecting), or null in any other phase. Only
 * Local starts as "Starting Marasi…".
 */
export function reachingText({ phase, connection }) {
  const name = startupName(connection);
  if (phase === "starting") return isNamed(connection) ? `Connecting to ${name}…` : "Starting Marasi…";
  if (phase === "connecting") return `Connecting to ${name}…`;
  return null;
}

/**
 * Why an added connection's Remove is off, or null when it is on: the
 * active connection waits for a switch away, and a local one whose run the
 * app owns (Go's OwnsRun) for a stop, since a removed connection's run
 * would keep running past quit.
 */
export function removeBlock({ isActive, ownedRun }) {
  if (isActive) return "Switch away first";
  if (ownedRun) return "Stop it first";
  return null;
}

const switchable = ["starting", "connecting", "failed", "auth-failed", "unpaired"];

/**
 * Whether the start screen offers Connections…: while the app is still
 * reaching the service and after it fails, so the researcher can switch
 * without waiting for a timeout.
 */
export const startupOffersConnections = (phase) => switchable.includes(phase);
