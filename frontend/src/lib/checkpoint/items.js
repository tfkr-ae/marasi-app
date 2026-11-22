// Display helpers for the Checkpoint page: what an intercepted item is
// called, how the dock groups items by host, and what Forward n and Drop n
// act on. Pure, so they load under node --test.

/** An item's kind tag by Type, as the dock and KindTag show it. */
export const KIND_LABELS = { request: "REQ", response: "RES", websocket: "WS", stream: "STREAM", trailer: "TRAILER" };

// Kinds that belong to a connection or a streamed pair, titled by kind,
// direction, host and path.
const MESSAGE_KINDS = new Set(["WS", "STREAM", "TRAILER"]);

const firstLine = (text) => (text ?? "").split(/\r?\n/, 1)[0];

// A field's value from the head. The name is everything before the first
// colon after its first character, so an HTTP/2 pseudo-header field such
// as ":authority" reads as itself, as Marasi's HTTP/2 text form writes it.
function headerOf(text, name) {
  const head = (text ?? "").split(/\r?\n\r?\n/, 1)[0];
  const wanted = name.toLowerCase();
  for (const line of head.split(/\r?\n/).slice(1)) {
    const at = line.indexOf(":", 1);
    if (at > 0 && line.slice(0, at).trim().toLowerCase() === wanted) return line.slice(at + 1).trim();
  }
  return "";
}

// "POST /x HTTP/1.1", "POST /x HTTP/2", or an absolute-form target
// "GET http://h/x HTTP/1.1".
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
  if (item.Type === "stream" || item.Type === "trailer") {
    const request = context.request ?? {};
    return {
      kind,
      method: item.Direction === "request" ? "C→S" : "S→C",
      path: request.Path ?? "",
      host: request.Host ?? "",
      status: 0,
    };
  }
  if (item.Type === "response") {
    const request = context.request ?? {};
    const status = Number(firstLine(text).split(" ")[1]) || 0;
    return { kind, method: request.Method ?? "", path: request.Path ?? "", host: request.Host ?? "", status };
  }
  const line = requestLine(text);
  // An HTTP/2 request names its host in :authority; a Host field may stand in.
  const host = headerOf(text, ":authority") || headerOf(text, "host") || line.host;
  return { kind, method: line.method, path: line.path, host, status: 0 };
}

// The media type is `base` or `base+codec`.
const suffixed = (mediaType, base) => mediaType === base || mediaType.startsWith(`${base}+`);

/**
 * The message framing a held request's or response's head names, as
 * Marasi decides it (stream.FramingOf): only the Content-Type counts, and
 * server-sent events and NDJSON stream only in a response. "" for a head
 * whose body isn't carried as stream messages, or any other kind.
 */
export function streamedHead(item, text) {
  if (item?.Type !== "request" && item?.Type !== "response") return "";
  const mediaType = headerOf(text, "content-type").split(";", 1)[0].trim().toLowerCase();
  if (suffixed(mediaType, "application/grpc-web") || suffixed(mediaType, "application/grpc-web-text")) return "grpc-web";
  if (suffixed(mediaType, "application/grpc")) return "grpc";
  if (mediaType.startsWith("application/connect+")) return "connect";
  if (item.Type !== "response") return "";
  if (mediaType === "text/event-stream") return "sse";
  if (mediaType === "application/x-ndjson" || mediaType === "application/jsonl") return "ndjson";
  return "";
}

/**
 * Whether Forward + intercept response applies to the item: a held request
 * whose body isn't carried as stream messages. A streamed pair's messages
 * are held by Stream intercept instead.
 */
export function offersInterceptResponse(item) {
  return item?.Type === "request" && !streamedHead(item, item.text);
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
 * connection or a stream message's or trailer block's pair:
 * "STREAM C→S · host/path".
 */
export function itemTitle(summary, number = 0) {
  if (MESSAGE_KINDS.has(summary.kind)) return `${summary.kind} ${summary.method} · ${summary.host}${summary.path}`;
  const line = `${summary.method} ${summary.path}`.trim();
  return number ? `#${number} · ${line}` : line;
}

/**
 * What the abandon toast calls an item: "#412" once Marasi has stored its
 * pair, else its title. `context` is the item's, as for summarize.
 */
export function abandonLabel(item, context) {
  // A stream message's context is its pair, whose number isn't the item's.
  const number = item.Type === "request" || item.Type === "response" ? context?.request?.Number : 0;
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
