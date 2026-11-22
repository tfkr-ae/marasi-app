// The streamed pair messages store's api over the service client (GLOSSARY
// Streamed pair, Stream message), and the mappers for the stream_message,
// stream_message.progress and streamed_pair.* events. The API's snake_case
// shapes become the PascalCase ones the store and the Messages modal read.

/** The most messages a page of GET /stream/{pair}/message holds. */
export const MESSAGE_PAGE = 500;

/** The messages the modal loads before it offers Load more. */
export const MESSAGE_CAP = 5000;

/** A stream message, from GET /stream/{pair}/message or stream_message. */
export function toStreamMessage(m) {
  return {
    ID: m.id,
    PairID: m.pair_id,
    Direction: m.direction,
    Framing: m.framing,
    // Null for a framing without a flags byte (SSE, NDJSON).
    Flags: m.flags ?? null,
    // Base64; "" when the event left a large payload out.
    Payload: m.payload ?? "",
    Compressed: Boolean(m.compressed),
    CreatedAt: m.created_at,
    Metadata: m.metadata ?? {},
    // Set on a stream_message whose payload was over the event's limit.
    PayloadTruncated: Boolean(m.payload_truncated),
  };
}

/** stream_message.progress: bytes of a message still arriving (envelope included). */
export const toStreamProgress = (p) => ({
  PairID: p.pair_id,
  Direction: p.direction,
  Framing: p.framing,
  Bytes: p.bytes,
});

// A direction of metadata.streamed or streamed_pair.ended's directions.
function toDirection(d) {
  if (!d) return null;
  return {
    Framing: d.framing ?? "",
    Messages: d.messages ?? null,
    Ending: d.ending || null,
    ResetCode: d.reset_code ?? "",
    Trailers: (d.trailers ?? []).map((t) => ({ Name: t.name, Value: t.value })),
  };
}

/** The ended directions, by name, from metadata.streamed or streamed_pair.ended. */
export function toDirections(directions) {
  if (!directions) return {};
  return Object.fromEntries(Object.entries(directions).map(([name, d]) => [name, toDirection(d)]));
}

/** streamed_pair.started, .updated or .ended. */
export const toStreamedPairEvent = (e) => ({
  PairID: e.pair_id,
  Streamed: e.streamed ?? null,
  Directions: toDirections(e.directions),
});

/**
 * checkpoint.held, as the streamed pair store reads it: a held stream
 * message, null for any other kind of item.
 */
export const toHeldStreamItem = (item) =>
  item?.type === "stream"
    ? { PairID: item.pair_id, Direction: item.direction, Injected: Boolean(item.metadata?.injected) }
    : null;

/** The single-message read: the text form (null when none) and the whole payload. */
export const toStreamMessageDetail = (m) => ({
  Text: m.text ?? null,
  Payload: m.payload ?? "",
});

/**
 * GET /traffic/{id} as what the modal reads of the pair: its head for the
 * header, its streamed state, and each direction's ending, count and
 * trailers once it ended (metadata.streamed).
 */
export function toStreamedPair(p) {
  return {
    pair: {
      ID: p.id,
      Number: p.number,
      Method: p.request?.method ?? "",
      Host: p.request?.host ?? "",
      Path: p.request?.path ?? "",
    },
    Streamed: p.streamed ?? null,
    Directions: toDirections(p.metadata?.streamed),
  };
}

export function createStreamedPairApi(client) {
  return {
    /** A client.bind() for an action of several calls, or null on a fake. */
    bind: () => client.bind?.() ?? null,
    /** One page of the pair's messages after `cursor`, oldest first. */
    async messagesPage(pairId, cursor, link = client) {
      const page = await link.get(`/stream/${pairId}/message`, { limit: MESSAGE_PAGE, ...(cursor ? { cursor } : {}) });
      return { items: (page.items ?? []).map(toStreamMessage), cursor: page.next_cursor ?? null };
    },
    async pair(pairId, link = client) {
      return toStreamedPair(await link.get(`/traffic/${pairId}`, { raw: false, prettified: false }));
    },
    async message(pairId, id, link = client) {
      return toStreamMessageDetail(await link.get(`/stream/${pairId}/message/${id}`));
    },
    /**
     * POST /stream/{pair}/inject: `body` is { direction, text | payload,
     * compress }. Answers once the message went out, so it waits while
     * Checkpoint holds it.
     */
    async inject(pairId, body, link = client) {
      return toStreamMessage(await link.post(`/stream/${pairId}/inject`, body));
    },
    /** POST /stream/{pair}/cancel. */
    async cancel(pairId, link = client) {
      await link.post(`/stream/${pairId}/cancel`, {});
    },
  };
}
