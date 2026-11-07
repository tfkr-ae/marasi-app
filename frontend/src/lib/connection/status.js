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
};

/** The status text for `phase`. */
export const phaseLabel = (phase) => labels[phase] ?? phase;

const amber = ["starting", "connecting", "reconnecting", "project-changed"];

/** The status dot's colour class for `phase`. */
export function phaseTone(phase) {
  if (phase === "connected") return "bg-success-500";
  if (amber.includes(phase)) return "bg-warning-500";
  if (phase === "idle") return "bg-surface-400";
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
