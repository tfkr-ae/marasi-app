// The WebSocket modal's api over the service client. Its keys keep the Go
// binding names createWebSocketStore was written against; each maps the
// API's snake_case shapes to the PascalCase ones the store and the modal
// read. The modal knows a connection by its upgrade request's id; the
// service by the connection's own id, which GET /traffic/{id}/websocket
// gives. The mappers for stream events live here too.
import { encodeText } from "./checkpointApi.js";

/** The most messages a page of GET /websocket/{id}/message holds. */
export const MESSAGE_PAGE = 500;

/** A connection, from GET /traffic/{id}/websocket or websocket.opened/closed. */
export function toConnection(c) {
  return {
    ID: c.id,
    RequestID: c.request_id,
    State: c.state,
    Transport: c.transport,
    Host: c.host,
    Path: c.path,
    StartedAt: c.started_at,
    ClosedAt: c.closed_at ?? null,
    CloseCode: c.close_code,
    CloseReason: c.close_reason,
    Deflate: c.deflate
      ? {
          ServerNoContextTakeover: c.deflate.server_no_context_takeover,
          ClientNoContextTakeover: c.deflate.client_no_context_takeover,
          ServerMaxWindowBits: c.deflate.server_max_window_bits,
          ClientMaxWindowBits: c.deflate.client_max_window_bits,
        }
      : null,
    RemovedExtensions: c.removed_extensions ?? [],
  };
}

/** A message, from GET /websocket/{id}/message or websocket.message. */
export function toMessage(m) {
  return {
    ID: m.id,
    ConnectionID: m.connection_id,
    RequestID: m.request_id,
    Direction: m.direction,
    Opcode: m.opcode,
    FrameCount: m.frame_count,
    Compressed: m.compressed,
    Payload: m.payload ?? "",
    IsBinary: m.is_binary,
    CreatedAt: m.created_at,
    Metadata: m.metadata ?? {},
  };
}

/** websocket.progress. */
export const toProgress = (p) => ({
  MessageID: p.message_id,
  ConnectionID: p.connection_id,
  RequestID: p.request_id,
  Direction: p.direction,
  Opcode: p.opcode,
  Bytes: p.bytes,
  Frames: p.frames,
});

/**
 * A held WebSocket Checkpoint item as a message of the modal's Checkpoint
 * tab, which orders them by CreatedAt: the time it was held.
 */
export const toHeldMessage = (item) => ({
  ID: item.id,
  ConnectionID: item.connection_id,
  RequestID: item.request_id,
  Direction: item.direction,
  Opcode: item.opcode,
  FrameCount: item.frame_count,
  Compressed: item.compressed,
  Payload: item.payload ?? "",
  CreatedAt: item.intercepted_at,
  Metadata: item.metadata ?? {},
});

// A 404 for the connection of an upgrade means none is stored yet.
const isHTTP404 = (err) => err?.status === 404;

export function createWebSocketApi(client) {
  // The stored connection of the upgrade, or null while none is stored:
  // the record lands just after the upgrade.
  async function connectionOf(requestId) {
    try {
      return await client.get(`/traffic/${requestId}/websocket`);
    } catch (err) {
      if (isHTTP404(err)) return null;
      throw err;
    }
  }

  async function connectionIdOf(requestId) {
    const conn = await connectionOf(requestId);
    if (!conn) throw new Error("The WebSocket connection isn't stored yet.");
    return conn.id;
  }

  async function messagesOf(connectionId) {
    const items = [];
    let cursor;
    do {
      const page = await client.get(`/websocket/${connectionId}/message`, { limit: MESSAGE_PAGE, cursor });
      items.push(...(page.items ?? []));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    // Newest first from the service; oldest first for the modal.
    return items.reverse().map(toMessage);
  }

  const flags = () => client.get("/checkpoint");

  return {
    async GetWebSocketMessages(requestId) {
      const conn = await connectionOf(requestId);
      return conn ? messagesOf(conn.id) : [];
    },
    GetWebSocketConnection: async (requestId) => {
      const conn = await connectionOf(requestId);
      return conn ? toConnection(conn) : null;
    },
    // By the connection's own id, for a held message whose upgrade has no
    // stored connection yet.
    GetWebSocketConnectionByID: async (connectionId) => {
      try {
        return toConnection(await client.get(`/websocket/${connectionId}`));
      } catch (err) {
        if (isHTTP404(err)) return null;
        throw err;
      }
    },
    GetWSInterceptFlag: async () => (await flags()).websocket_intercept === true,
    // The flag is turned over on the connection it was read from.
    async ToggleWSIntercept() {
      const link = client.bind?.() ?? client;
      const { websocket_intercept: on } = await link.get("/checkpoint");
      const list = await link.post("/checkpoint/websocket-intercept", { websocket_intercept: !on });
      return list.websocket_intercept === true;
    },
    // The connection's oldest held message, or null.
    async GetWSIntercepted(requestId) {
      const { items = [] } = await client.get("/checkpoint", { kind: "websocket" });
      const held = items.find((item) => item.request_id === requestId);
      return held ? toHeldMessage(held) : null;
    },
    ForwardWSIntercepted: (id, opcode, payload) =>
      client.post(`/checkpoint/${id}/forward`, { payload: encodeText(payload), opcode }),
    DropWSIntercepted: (id) => client.post(`/checkpoint/${id}/drop`, {}),
    async InjectWebSocketMessage(requestId, direction, opcode, payload, neverCompress) {
      const id = await connectionIdOf(requestId);
      return toMessage(
        await client.post(`/websocket/${id}/inject`, {
          direction,
          opcode,
          payload: encodeText(payload),
          compress: neverCompress ? "never" : "auto",
        }),
      );
    },
    async CloseWebSocket(requestId, code, reason) {
      const id = await connectionIdOf(requestId);
      return toConnection(await client.post(`/websocket/${id}/close`, { code, reason }));
    },
  };
}
