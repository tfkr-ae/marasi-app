// Traffic over the service client: the shapes the API gives (snake_case,
// base64 bodies) mapped to the ones the Ledger, sitemap and their
// components read (PascalCase, as the Go bindings gave them), and the
// reads every traffic view shares: a page of traffic and a count, each
// minus the project's content-type exclusion.

import { decodeBase64Text } from "../lib/service/bytes.js";

/** The service's largest GET /traffic page. */
export const SERVICE_PAGE_ROWS = 500;

/** A route snapshot ({name, address}), or null. */
export function toRoute(route) {
  return route ? { Name: route.name ?? "", Address: route.address ?? "" } : null;
}

/** A TrafficSummary as a Ledger row. */
export function toRow(item) {
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
    RespondedAt: item.responded_at ?? null,
    Highlight: item.highlight ?? null,
    Route: toRoute(item.upstream_proxy),
  };
}

/** A traffic.request event as the stores' live request. */
export function toRequestEvent(data) {
  return {
    ID: data.id,
    Number: data.number,
    Scheme: data.scheme,
    Method: data.method,
    Host: data.host,
    Path: data.path,
    Metadata: data.metadata ?? {},
    RequestedAt: data.requested_at,
    SitemapNode: data.sitemap_node,
  };
}

/** A traffic.response event as the stores' live response (no body). */
export function toResponseEvent(data) {
  return {
    ID: data.id,
    Status: data.status,
    StatusCode: data.status_code,
    ContentType: data.content_type,
    Length: data.length,
    Metadata: data.metadata ?? {},
    RespondedAt: data.responded_at,
    Route: toRoute(data.upstream_proxy),
  };
}

/**
 * The query for GET /traffic/{id} that leaves out what a reader doesn't
 * need: `raw: false` drops the raw request and response (base64),
 * `prettified: false` the prettified copies. Both default to true, as
 * Marasi's do. A dropped part reads as "" in toDetails.
 */
export function pairQuery({ raw = true, prettified = true } = {}) {
  const query = {};
  if (!raw) query.raw = false;
  if (!prettified) query.prettified = false;
  return query;
}

/** What a reader that shows only the raw text asks for. */
export const RAW_ONLY = Object.freeze({ prettified: false });
/** What a reader that shows only number, method, host, path and status asks for. */
export const NO_BODIES = Object.freeze({ raw: false, prettified: false });

/**
 * GET /traffic/{id} as the full pair the drawer reads (the binding's
 * RequestResponseRow): raw bodies as text, prettified copies as "" when
 * the pair has none.
 */
export function toDetails(pair) {
  const route = toRoute(pair.upstream_proxy);
  const request = pair.request ?? {};
  const response = pair.response ?? {};
  return {
    Request: {
      ID: pair.id,
      Number: pair.number,
      Scheme: request.scheme,
      Method: request.method,
      Host: request.host,
      Path: request.path,
      Raw: decodeBase64Text(request.raw),
      RequestedAt: request.requested_at,
    },
    Response: {
      ID: pair.id,
      Status: response.status,
      StatusCode: response.status_code,
      ContentType: response.content_type,
      Length: response.length,
      Raw: decodeBase64Text(response.raw),
      RespondedAt: response.responded_at ?? null,
      Route: route,
    },
    Metadata: pair.metadata ?? {},
    Note: pair.note ?? "",
    Highlight: pair.highlight ?? null,
    Prettified: { Request: pair.prettified?.request ?? "", Response: pair.prettified?.response ?? "" },
    Route: route,
  };
}

/**
 * An invalid_query refusal as the stores read query errors, as data:
 * { Message, Position } (Position 0 when the fault isn't in the text).
 * null for any other error.
 */
export function queryErrorOf(err) {
  if (err?.code !== "invalid_query") return null;
  return { Message: err.body?.message ?? String(err), Position: err.body?.position ?? 0 };
}

// The query parameters shared by traffic reads; empty values are left out.
function trafficQuery({ query, exclusion, asOf }) {
  const params = {};
  if (query) params.q = query;
  if (exclusion?.length) params.exclude = exclusion;
  if (asOf) params.as_of = asOf;
  return params;
}

function emptyPage(queryError = null) {
  return { Items: [], NextCursor: null, PrevCursor: null, AsOf: "", IndexComplete: true, QueryError: queryError };
}

/**
 * Reads one page of traffic, as the binding's QueryTraffic did:
 * `{ Query, OrderBy, Cursor, Direction, AsOf, Limit }` →
 * `{ Items (display order), NextCursor, PrevCursor, AsOf, IndexComplete,
 * QueryError }`. `exclusion` is the list to leave out (null for none).
 * A limit past the service's page is read in several pages, each after the
 * last under the first one's as_of.
 */
export async function readTraffic(client, request, exclusion) {
  const backward = request.Direction === "backward";
  let left = request.Limit > 0 ? request.Limit : SERVICE_PAGE_ROWS;
  let cursor = request.Cursor || "";
  let asOf = request.AsOf || "";
  const pages = [];
  try {
    for (;;) {
      const limit = Math.min(left, SERVICE_PAGE_ROWS);
      const params = { ...trafficQuery({ query: request.Query, exclusion, asOf }) };
      if (request.OrderBy) params.order_by = request.OrderBy;
      if (cursor) params.cursor = cursor;
      params.direction = backward ? "backward" : "forward";
      params.limit = limit;
      const page = await client.get("/traffic", params);
      // The service lists a page in reverse display order.
      const items = [...(page.items ?? [])].reverse().map(toRow);
      pages.push({ items, next: page.next_cursor ?? null, prev: page.prev_cursor ?? null, asOf: page.as_of ?? "", index: page.index?.complete ?? true });
      asOf = asOf || page.as_of || "";
      left -= items.length;
      const onward = backward ? page.prev_cursor : page.next_cursor;
      if (left <= 0 || !onward || items.length < limit) break;
      cursor = onward;
    }
  } catch (err) {
    const queryError = queryErrorOf(err);
    if (queryError) return emptyPage(queryError);
    throw err;
  }
  // Backward pages arrive from the bottom up.
  const ordered = backward ? [...pages].reverse() : pages;
  return {
    Items: ordered.flatMap((page) => page.items),
    NextCursor: ordered.at(-1).next,
    PrevCursor: ordered[0].prev,
    AsOf: pages[0].asOf || "",
    IndexComplete: pages.every((page) => page.index),
    QueryError: null,
  };
}

/**
 * Counts traffic, as the binding's CountTraffic did:
 * `{ Count, Capped, IndexComplete, QueryError }`. `after` counts only pairs
 * captured after that id, `asOf` only those up to it.
 */
export async function countTraffic(client, { query, after, asOf }, exclusion) {
  const params = trafficQuery({ query, exclusion, asOf });
  if (after) params.after = after;
  try {
    const counted = await client.get("/traffic/count", params);
    return { Count: counted.count, Capped: counted.capped, IndexComplete: counted.index?.complete ?? true, QueryError: null };
  } catch (err) {
    const queryError = queryErrorOf(err);
    if (queryError) return { Count: 0, Capped: false, IndexComplete: true, QueryError: queryError };
    throw err;
  }
}
