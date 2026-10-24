// The Armory traffic table's columns and paging, and the drawer's stepping
// through the run's pairs. Plain data, so it loads under node.
import { sameID } from "../ledger/pairs.js";

/**
 * The table's columns, left to right, sized like the Ledger's. Host/path is
 * the one flexible track, so the table reflows instead of scrolling sideways.
 */
export const TRAFFIC_COLUMNS = Object.freeze([
  { key: "number", label: "#", width: "52px", align: "right" },
  { key: "time", label: "Time", width: "70px" },
  { key: "method", label: "Method", width: "80px" },
  { key: "url", label: "Host / Path", width: "minmax(0,1fr)" },
  { key: "status", label: "Status", width: "60px", align: "right" },
  { key: "size", label: "Length", width: "62px", align: "right" },
]);

export const TRAFFIC_TEMPLATE = TRAFFIC_COLUMNS.map((column) => column.width).join(" ");

/**
 * Page `pageIndex` of the run's pairs: its rows, the index of its first row
 * in `rows`, and how many pages there are (at least one).
 */
export function trafficPage(rows, { pageIndex, pageSize }) {
  const start = pageIndex * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    start,
    pageCount: Math.max(1, Math.ceil(rows.length / pageSize)),
  };
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
