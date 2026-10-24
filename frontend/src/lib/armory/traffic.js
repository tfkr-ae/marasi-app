// The Armory traffic table's columns and paging. Plain data, so it loads
// under node.

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
