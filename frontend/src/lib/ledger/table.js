// The Ledger table's columns, and how a pair's cells, badges and highlight
// are shown. Plain functions over the store's rows, so they load under node.
import { upgradeFromLedgerRow, upgradePresentation } from "../websocket/presentation.js";
import { sameID } from "./pairs.js";

/**
 * The header row's height in px for rows `rowHeight` px tall (ledgerRowHeight
 * in lib/textSize.js gives that for the Text size).
 */
export function headerHeight(rowHeight) {
  return rowHeight + 2;
}

/**
 * The table's columns, left to right. `width` is a CSS grid track, in rem so
 * the columns grow with the Text size; `sort` is the Marasi order_by field a
 * click on the header sorts by.
 */
export const LEDGER_COLUMNS = Object.freeze([
  { key: "number", label: "#", width: "3.25rem", align: "right", sort: "number" },
  { key: "badges", label: "", width: "2.875rem" },
  { key: "time", label: "Time", width: "4.375rem", sort: "requested_at" },
  { key: "method", label: "Method", width: "5rem", sort: "method" },
  { key: "host", label: "Host", width: "10.625rem", sort: "host" },
  { key: "path", label: "Path", width: "minmax(11.25rem,1fr)", sort: "path" },
  { key: "status", label: "Status", width: "3.75rem", align: "right", sort: "status_code" },
  { key: "type", label: "Type", width: "7.5rem", sort: "content_type" },
  { key: "size", label: "Size", width: "3.875rem", align: "right", sort: "length" },
]);

// Newest first by Marasi's pair number (marasi docs/adr/2026-10-16-pairs-are-numbered-in-capture-order.md): unlike
// requested_at, it reads strictly in order under concurrent capture.
export const DEFAULT_SORT = Object.freeze({ field: "number", desc: true });

const isDefaultSort = (sort) => sort?.field === DEFAULT_SORT.field && sort?.desc === DEFAULT_SORT.desc;

/** The column's aria-sort: "ascending" or "descending" when the table is sorted by it, else "none". */
export function sortAria(sort, column) {
  if (!column.sort || sort?.field !== column.sort) return "none";
  return sort.desc ? "descending" : "ascending";
}

/**
 * "↑" or "↓" when the table is sorted by the column's field, else "". The
 * default sort shows none, so an arrow always means a sort the researcher
 * chose.
 */
export function sortMark(sort, column) {
  if (isDefaultSort(sort)) return "";
  const aria = sortAria(sort, column);
  return aria === "none" ? "" : aria === "descending" ? "↓" : "↑";
}

/** The header's tooltip. */
export function sortTitle(sort, column) {
  if (isDefaultSort(sort) && column.sort === DEFAULT_SORT.field) return "Newest first · click for oldest first";
  return `Sort by ${column.label === "#" ? "number" : column.label.toLowerCase()}`;
}

/**
 * The scroll position, measured from the first row, that keeps the row
 * `anchorID` where it was (`offset` px scrolled into it) after the rows
 * changed around it, or null when it is gone.
 */
export function keepRowInPlace({ anchorID, offset, rows, rowHeight }) {
  if (anchorID == null) return null;
  const index = rows.findIndex((row) => sameID(row.ID, anchorID));
  return index < 0 ? null : index * rowHeight + offset;
}

/**
 * True when row `index` sits right under the sticky header, so its focus
 * frame needs no top edge: the header's own border is there. `scrollTop`
 * is measured from the first row.
 */
export function meetsHeader(index, scrollTop, rowHeight) {
  return index * rowHeight === Math.round(scrollTop);
}

/**
 * The status bar's position readout: which rows of the results are in view,
 * "rows 40,011–40,047". `start` is the loaded window's offset in the results
 * (null when unknown) and `first`/`last` the window rows in view. "" when
 * unknown or empty.
 */
export function positionLabel({ start, first, last, empty = false }) {
  if (start == null || empty) return "";
  return `rows ${(start + first + 1).toLocaleString()}–${(start + last + 1).toLocaleString()}`;
}

/**
 * True when row `index`'s bottom edge sits on the viewport's bottom (`height`
 * px of rows below the header), so its focus frame needs no bottom edge:
 * the drawer's border or the status bar is there.
 */
export function meetsFooter(index, scrollTop, rowHeight, height) {
  return (index + 1) * rowHeight === Math.round(scrollTop) + Math.round(height);
}

/**
 * The scroll position, measured from the first row, that a jump to row
 * `index` uses: unchanged when the row is fully in view, else the one that
 * puts the row in the middle (never above the first row).
 */
export function scrollToCenter({ scrollTop, height, rowHeight }, index) {
  const top = index * rowHeight;
  if (top >= scrollTop && top + rowHeight <= scrollTop + height) return scrollTop;
  return Math.max(0, top - (height - rowHeight) / 2);
}

/**
 * The rows a windowed list renders: those in view and `overscan` more on
 * either side. `scrollTop` is measured from the first row. `end` is exclusive.
 */
export function visibleRange({ scrollTop, height, count, rowHeight, overscan }) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

/**
 * The top row in view at `scrollTop`, measured from the first row: its
 * index, and how many px the view is scrolled into it.
 */
export function topRow(scrollTop, rowHeight) {
  const index = Math.floor(scrollTop / rowHeight);
  return { index, offset: scrollTop - index * rowHeight };
}

/** How many rows start in a view `height` px tall: at least one. */
export function rowsPerView(height, rowHeight) {
  return Math.max(1, Math.ceil(height / rowHeight));
}

/** How far a page down or up scrolls: a view's height less one row, but at least a row. */
export function pageDistance(height, rowHeight) {
  return Math.max(height - rowHeight, rowHeight);
}

/**
 * The scroll position, measured from the first row, that shows row `index`
 * while moving as little as possible.
 */
export function scrollToReveal({ scrollTop, height, rowHeight }, index) {
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + height) return top + rowHeight - height;
  return scrollTop;
}

/** The CSS grid template every row and the header share. */
export function rowTemplate(columns) {
  return columns.map((column) => column.width).join(" ");
}

const SHORT_TYPES = {
  "application/javascript": "js",
  "text/javascript": "js",
  "text/plain": "text",
  "text/event-stream": "sse",
  "image/jpeg": "jpg",
  "image/x-icon": "ico",
  "application/octet-stream": "binary",
  "application/x-www-form-urlencoded": "form",
};

/** A short name for a content type: "json" for "application/json; charset=utf-8". */
export function shortType(contentType) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!type) return "";
  return SHORT_TYPES[type] ?? type.split("/")[1] ?? type;
}

/**
 * The Status column's text: the code, or "…" while a pair has no response.
 * Marasi stores -1 for that (status_code's default); a live pair has 0.
 */
export function statusText(code) {
  const n = Number(code);
  return n > 0 ? String(n) : "…";
}

/** A response length for the Size column: "512 B", "2.0 KB", "3.0 MB"; blank for none. */
export function formatSize(length) {
  const n = Number(length);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The badges a row shows, in slot order: { key, label, tone?, slashed? }.
 * `label` is the badge's tooltip and its line in the "+N" list; `tone` is a
 * text colour class.
 */
export function rowBadges(row) {
  const meta = row?.Metadata ?? {};
  const upgrade = upgradePresentation(upgradeFromLedgerRow(row));
  const badges = [];
  if (upgrade.isUpgrade) {
    badges.push({
      key: "websocket",
      label: upgrade.tooltip || "WebSocket upgrade",
      tone: upgrade.iconClass,
      slashed: Boolean(upgrade.slashed),
    });
  }
  if (meta.launchpad) badges.push({ key: "launchpad", label: "In a launchpad" });
  if (meta.armory_run_id) badges.push({ key: "armory", label: "From Armory" });
  if (meta.intercepted) {
    badges.push({ key: "intercepted", label: "Intercepted" });
    if (meta["original-request"] !== undefined) {
      badges.push({ key: "edited-request", label: "Request edited in flight" });
    }
    if (meta["original-response"] !== undefined) {
      badges.push({ key: "edited-response", label: "Response edited in flight" });
    }
  }
  if (meta.has_note == 1 || row?.Note) badges.push({ key: "note", label: "Has a note" });
  if (meta.override_host) {
    badges.push({ key: "override-host", label: `Host overridden: ${meta.override_host}` });
  }
  return badges;
}

/**
 * Splits a row's badges over its three slots: all of them when they fit,
 * otherwise the first two and a "+N" count of the rest.
 */
export function badgeSlots(badges, slots = 3) {
  if (badges.length <= slots) return { visible: badges, more: 0 };
  const visible = badges.slice(0, slots - 1);
  return { visible, more: badges.length - visible.length };
}

/**
 * The colour of a row's highlight (1-8) from the palette, or null. Old hex
 * highlights in metadata are not drawn: opening the project migrates them
 * to numbers.
 */
export function rowHighlight(row, palette) {
  const number = row?.Highlight;
  if (number >= 1 && number <= palette.length) return palette[number - 1].color;
  return null;
}
