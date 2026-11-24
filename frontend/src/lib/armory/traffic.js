// The Armory traffic table's columns, and the drawer's stepping through the
// run's pairs. Plain data, so it loads under node.
import { sameID } from "../ledger/pairs.js";

/**
 * The table's columns, left to right, sized like the Ledger's. Host/path is
 * the one flexible track, so the table reflows instead of scrolling sideways.
 * A `sortable` column's header sorts the run's traffic by it.
 */
export const TRAFFIC_COLUMNS = Object.freeze([
  { key: "number", label: "#", width: "3.25rem", align: "right", sortable: true },
  { key: "time", label: "Time", width: "4.375rem", sortable: true },
  { key: "method", label: "Method", width: "5rem" },
  { key: "url", label: "Host / Path", width: "minmax(0,1fr)" },
  { key: "status", label: "Status", width: "3.75rem", align: "right", sortable: true },
  { key: "size", label: "Length", width: "3.875rem", align: "right", sortable: true },
]);

export const TRAFFIC_TEMPLATE = TRAFFIC_COLUMNS.map((column) => column.width).join(" ");

/** The grpc-status column, after Status, for a run of gRPC calls. */
const GRPC_COLUMN = Object.freeze({ key: "grpc", label: "gRPC status", width: "10rem" });

/** The table's columns: with grpc-status after Status when `grpc`. */
export function trafficColumns(grpc) {
  if (!grpc) return TRAFFIC_COLUMNS;
  const at = TRAFFIC_COLUMNS.findIndex((column) => column.key === "status") + 1;
  return [...TRAFFIC_COLUMNS.slice(0, at), GRPC_COLUMN, ...TRAFFIC_COLUMNS.slice(at)];
}

/** The grid template for `columns`. */
export const trafficTemplate = (columns) => columns.map((column) => column.width).join(" ");

/** The gRPC status codes' names, by number. */
export const GRPC_STATUS_NAMES = Object.freeze([
  "OK",
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
  "UNAUTHENTICATED",
]);

/** A grpc-status as the table shows it: "3 INVALID_ARGUMENT", or "" for none. */
export function grpcStatusText(code) {
  if (code == null) return "";
  const name = GRPC_STATUS_NAMES[code];
  return name ? `${code} ${name}` : String(code);
}

/** Whether a run's pairs are gRPC calls, so their grpc-status shows. */
export function isGrpcRun(run, rows = []) {
  if (run?.TemplateFraming === "grpc" || run?.TemplateFraming === "grpc-web") return true;
  return rows.some((row) => row.GrpcStatus != null);
}

/**
 * The index in `rows` of the pair `delta` steps from the open pair `openId`,
 * or -1 past either end or when `rows` no longer holds the open pair.
 */
export function stepRequest(rows, openId, delta) {
  const current = rows.findIndex((row) => sameID(row.ID, openId));
  const index = current + delta;
  return current === -1 || index < 0 || index >= rows.length ? -1 : index;
}

/**
 * A group header's value: the status code, the exact length in bytes, or
 * "…" for the pairs with no response yet ("").
 */
export function groupLabel(groupBy, value) {
  if (value === "") return "…";
  return groupBy === "length" ? `${Number(value).toLocaleString("en-US")} B` : value;
}

/** A group's share of the run, with one decimal so the points line up. */
export function shareText(share) {
  return `${share.toFixed(1)}%`;
}
