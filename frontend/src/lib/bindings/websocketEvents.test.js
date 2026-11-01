// Marasi's websocket.* events in the v1 shapes connectionStore reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webSocketProgress } from "./websocket.js";

test("websocket.progress is v1's ws-progress record", () => {
  assert.deepEqual(
    webSocketProgress({
      message_id: "m1",
      connection_id: "c1",
      request_id: "r1",
      direction: "server",
      opcode: 2,
      bytes: 65536,
      frames: 4,
    }),
    { MessageID: "m1", ConnectionID: "c1", RequestID: "r1", Direction: "server", Opcode: 2, Bytes: 65536, Frames: 4 },
  );
});
