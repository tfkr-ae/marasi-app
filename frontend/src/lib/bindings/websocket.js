// Marasi's WebSocket connections, messages, progress and held messages in
// v1's shapes, Go's field names, as the WebSocket modal and connectionStore
// read them. Payloads stay base64, as Wails sent a Go []byte.

/** A Marasi connection (GET /websocket/{id}, websocket.opened, websocket.closed) as v1's domain.WebSocketConnection. */
export const webSocketConnection = (connection) => ({
  ID: connection.id,
  RequestID: connection.request_id,
  State: connection.state,
  Transport: connection.transport,
  Host: connection.host,
  Path: connection.path,
  StartedAt: connection.started_at,
  ClosedAt: connection.closed_at ?? null,
  CloseCode: connection.close_code,
  CloseReason: connection.close_reason,
  Deflate: connection.deflate
    ? {
        ServerNoContextTakeover: connection.deflate.server_no_context_takeover,
        ClientNoContextTakeover: connection.deflate.client_no_context_takeover,
        ServerMaxWindowBits: connection.deflate.server_max_window_bits,
        ClientMaxWindowBits: connection.deflate.client_max_window_bits,
      }
    : null,
  RemovedExtensions: connection.removed_extensions ?? [],
});

/** A Marasi message (GET /websocket/{id}/message, websocket.message) as v1's domain.WebSocketMessage. */
export const webSocketMessage = (message) => ({
  ID: message.id,
  ConnectionID: message.connection_id,
  RequestID: message.request_id,
  Direction: message.direction,
  Opcode: message.opcode,
  FrameCount: message.frame_count,
  Compressed: message.compressed,
  Payload: message.payload,
  IsBinary: message.is_binary,
  CreatedAt: message.created_at,
  Metadata: message.metadata ?? {},
});

/**
 * A held WebSocket message (a Checkpoint item of type websocket, as GET
 * /checkpoint lists it and checkpoint.held carries it) as the v1 message
 * the WebSocket modal's Checkpoint tab queues. CreatedAt is when it was held.
 */
export const heldMessage = (item) => ({
  ID: item.id,
  Type: item.type,
  ConnectionID: item.connection_id,
  RequestID: item.request_id,
  Direction: item.direction,
  Opcode: item.opcode,
  Payload: item.payload,
  CreatedAt: item.intercepted_at,
});

/** Marasi's websocket.progress, a message whose frames are still arriving, as v1's ws-progress. */
export const webSocketProgress = (progress) => ({
  MessageID: progress.message_id,
  ConnectionID: progress.connection_id,
  RequestID: progress.request_id,
  Direction: progress.direction,
  Opcode: progress.opcode,
  Bytes: progress.bytes,
  Frames: progress.frames,
});
