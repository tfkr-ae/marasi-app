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
