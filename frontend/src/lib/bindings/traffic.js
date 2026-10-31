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
