// Display helpers for the Checkpoint page: what an intercepted item is
// called, how the dock groups items by host, and what Forward n and Drop n
// act on. Pure, so they load under node --test.

/** An item's kind tag by Type, as the dock and KindTag show it. */
export const KIND_LABELS = { request: "REQ", response: "RES", websocket: "WS" };

const firstLine = (text) => (text ?? "").split(/\r?\n/, 1)[0];

function headerOf(text, name) {
  const head = (text ?? "").split(/\r?\n\r?\n/, 1)[0];
  const wanted = name.toLowerCase();
  for (const line of head.split(/\r?\n/).slice(1)) {
    const at = line.indexOf(":");
    if (at > 0 && line.slice(0, at).trim().toLowerCase() === wanted) return line.slice(at + 1).trim();
  }
  return "";
}

// "POST /x HTTP/1.1", or an absolute-form target "GET http://h/x HTTP/1.1".
function requestLine(text) {
  const [method = "", target = ""] = firstLine(text).split(" ");
  try {
    if (/^https?:\/\//i.test(target)) {
      const url = new URL(target);
      return { method, path: url.pathname + url.search, host: url.host };
    }
  } catch {
    // Not a URL: show the target as written.
  }
  return { method, path: target, host: "" };
}

/**
 * What the dock and the top bar show for an item, given `text`, its text as
 * the researcher sees it. `context` carries what the item doesn't: the
 * request a held response answers ({ Method, Path, Host }) and a WebSocket
 * message's connection ({ Host, Path }).
 */
export function summarize(item, text, context = {}) {
  const kind = KIND_LABELS[item.Type] ?? "";
  if (item.Type === "websocket") {
    const connection = context.connection ?? {};
    return {
      kind,
      method: item.Direction === "client" ? "C→S" : "S→C",
      path: connection.Path ?? "",
      host: connection.Host ?? "",
      status: 0,
    };
  }
  if (item.Type === "response") {
    const request = context.request ?? {};
    const status = Number(firstLine(text).split(" ")[1]) || 0;
    return { kind, method: request.Method ?? "", path: request.Path ?? "", host: request.Host ?? "", status };
  }
  const line = requestLine(text);
  return { kind, method: line.method, path: line.path, host: headerOf(text, "host") || line.host, status: 0 };
}

/**
 * The dock's tree: [{ host, items }] with hosts in the order their first
 * item was intercepted, and hold order within each host.
 */
export function groupByHost(items, hostOf) {
  const groups = new Map();
  for (const item of items) {
    const host = hostOf(item) ?? "";
    if (!groups.has(host)) groups.set(host, { host, items: [] });
    groups.get(host).items.push(item);
  }
  return [...groups.values()];
}

/**
 * The top bar's title: "#412 · GET /login", without the number while
 * Marasi hasn't stored the pair (a held request), or a WebSocket message's
 * connection.
 */
export function itemTitle(summary, number = 0) {
  if (summary.kind === "WS") return `WS ${summary.method} · ${summary.host}${summary.path}`;
  const line = `${summary.method} ${summary.path}`.trim();
  return number ? `#${number} · ${line}` : line;
}

/**
 * What the abandon toast calls an item: "#412" once Marasi has stored its
 * pair, else its title. `context` is the item's, as for summarize.
 */
export function abandonLabel(item, context) {
  const number = context?.request?.Number;
  return number ? `#${number}` : itemTitle(summarize(item, item.text, context ?? {}));
}

/** The toast for an item Marasi dropped because its client left. */
export const abandonText = (label, editLost) =>
  `${label} dropped · client left${editLost ? " · edit lost" : ""}`;

/**
 * The ids Forward n and Drop n act on: the picked items, else every item,
 * in hold order. `state` is the Checkpoint store's.
 */
export function bulkTargets(state) {
  const picked = new Set(state.picked);
  const ids = state.items.map((item) => item.ID);
  return picked.size ? ids.filter((id) => picked.has(id)) : ids;
}

/** The title of Drop n's confirmation. */
export const dropTitle = (n) => `Drop ${n} intercepted item${n === 1 ? "" : "s"}?`;

const UNITS = [
  ["d", 86400],
  ["h", 3600],
  ["m", 60],
];

/** How long since `iso`, in its largest whole unit: "2s", "1m", "1h", "2d". */
export function interceptedFor(iso, now = Date.now()) {
  const at = Date.parse(iso ?? "");
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  for (const [unit, size] of UNITS) if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`;
  return `${seconds}s`;
}

/** The ids as the tree shows them, without the items of collapsed hosts. */
export function treeOrder(groups, collapsed = new Set()) {
  return groups.filter((group) => !collapsed.has(group.host)).flatMap((group) => group.items.map((item) => item.ID));
}
