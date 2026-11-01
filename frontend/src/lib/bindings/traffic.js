// Marasi's traffic payloads in the shapes v1's frontend reads: Wails sent
// the Go structs' field names, raw bytes as text, and Go's zero time for a
// pair with no response yet.

// Go's zero time, which v1 sent for a pair with no response.
const zeroTime = "0001-01-01T00:00:00Z";

const decoder = new TextDecoder();

/** Marasi's base64 bytes as text, as v1's RawField marshalled them. */
export function rawText(base64) {
  if (base64 == null) return null;
  return decoder.decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

/** An upstream_proxy as v1's RouteSnapshot, or null. */
const route = (upstream) => (upstream ? { Name: upstream.name, Address: upstream.address } : null);

/** A GET /traffic item as v1's RequestResponseSummary. */
export function pairSummary(item) {
  return {
    ID: item.id,
    Number: item.number,
    Scheme: item.scheme,
    Method: item.method,
    Host: item.host,
    Path: item.path,
    Status: item.status,
    StatusCode: item.status_code,
    ContentType: item.content_type,
    Length: item.length,
    Metadata: item.metadata ?? {},
    RequestedAt: item.requested_at,
    RespondedAt: item.responded_at ?? zeroTime,
    Note: "",
    Highlight: item.highlight ?? null,
    Route: route(item.upstream_proxy),
  };
}

/** A GET /traffic/{id} answer as v1's RequestResponseRow. */
export function pairRow(pair) {
  const request = pair.request ?? {};
  const response = pair.response ?? {};
  const metadata = pair.metadata ?? {};
  const prettified = { Request: pair.prettified?.request ?? "", Response: pair.prettified?.response ?? "" };
  return {
    Request: {
      ID: pair.id,
      Number: pair.number,
      Scheme: request.scheme,
      Method: request.method,
      Host: request.host,
      Path: request.path,
      Raw: rawText(request.raw),
      Metadata: metadata,
      Prettified: prettified.Request,
      RequestedAt: request.requested_at,
    },
    Response: {
      ID: pair.id,
      Status: response.status,
      StatusCode: response.status_code,
      ContentType: response.content_type,
      Length: response.length,
      Raw: rawText(response.raw),
      Metadata: metadata,
      Prettified: prettified.Response,
      RespondedAt: response.responded_at ?? zeroTime,
      Route: route(pair.upstream_proxy),
    },
    Metadata: metadata,
    Note: pair.note ?? "",
    Highlight: pair.highlight ?? null,
    Prettified: prettified,
    Route: route(pair.upstream_proxy),
  };
}

/** A traffic.request event as v1's request event, a ProxyRequest. */
export function requestEvent(event) {
  return {
    ID: event.id,
    Number: event.number,
    Scheme: event.scheme,
    Method: event.method,
    Host: event.host,
    Path: event.path,
    Metadata: event.metadata ?? {},
    RequestedAt: event.requested_at,
    SitemapNode: event.sitemap_node,
  };
}

/** A traffic.response event as v1's response event, a ProxyResponse. */
export function responseEvent(event) {
  return {
    ID: event.id,
    Status: event.status,
    StatusCode: event.status_code,
    ContentType: event.content_type,
    Length: event.length,
    Metadata: event.metadata ?? {},
    RespondedAt: event.responded_at,
    Route: route(event.upstream_proxy),
  };
}

/**
 * A websocket.handshake_ended event as v1's ws-state event: an upgrade that
 * failed or was dropped, whose state Marasi has already stored.
 */
export const handshakeEndedEvent = (event) => ({ RequestID: event.request_id, State: event.state });
