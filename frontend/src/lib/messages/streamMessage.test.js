import { test } from "node:test";
import assert from "node:assert/strict";
import { detailOf, messageChips, messagePreview, messageSize, pairTrailers } from "./streamMessage.js";

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const msg = (overrides = {}) => ({
  ID: "m1",
  Direction: "response",
  Framing: "grpc",
  Flags: 0,
  Payload: "",
  Compressed: false,
  Metadata: {},
  PayloadTruncated: false,
  ...overrides,
});

// A protobuf ChatMessage { seq: 1, sender: "server", text: "echo: hi" }.
const proto = [0x08, 0x01, 0x12, 0x06, ...Buffer.from("server"), 0x1a, 0x08, ...Buffer.from("echo: hi")];

test("a gRPC-Web trailer message and a Connect end of stream are labelled, and show their payload as text", () => {
  const trailers = "grpc-status: 0\r\ngrpc-message: ok\r\n";
  const web = msg({ Framing: "grpc-web", Flags: 128, Payload: b64(Buffer.from(trailers)) });
  assert.deepEqual(messageChips(web).map((c) => c.label), ["Trailers"]);
  assert.equal(messagePreview(web), "grpc-status: 0 grpc-message: ok");
  // The text form Marasi gives such a message is a meaningless hex literal.
  assert.deepEqual(detailOf(web, { Text: "`677270`", Payload: web.Payload }, "text"), {
    text: trailers,
    language: null,
    note: "",
  });

  const connect = msg({ Framing: "connect", Flags: 2, Payload: b64(Buffer.from("{}")) });
  assert.deepEqual(messageChips(connect).map((c) => c.label), ["End of stream"]);
  assert.equal(detailOf(connect, { Text: "`7b7d`", Payload: connect.Payload }, "text").text, "{}");
});

test("a protobuf message shows its text form, highlighted as protobuf, or as JSON for a +json codec", () => {
  const m = msg({ Payload: b64(proto) });
  assert.deepEqual(detailOf(m, { Text: '1:VARINT 1\n2:LEN {"server"}', Payload: m.Payload }, "text"), {
    text: '1:VARINT 1\n2:LEN {"server"}',
    language: "protobuf",
    note: "",
  });
  assert.equal(detailOf(m, { Text: '{"seq":1}', Payload: m.Payload }, "text").language, "json");
  assert.equal(messagePreview(m), "server · echo: hi");
});

test("a message with no text form shows as UTF-8 text, or read-only hex when it isn't text", () => {
  const sse = msg({ Framing: "sse", Flags: null, Payload: b64(Buffer.from("data: hello\n\n")) });
  assert.deepEqual(detailOf(sse, { Text: null, Payload: sse.Payload }, "text"), {
    text: "data: hello\n\n",
    language: null,
    note: "",
  });
  const binary = msg({ Payload: b64([0xff, 0x00, 0x10]) });
  assert.deepEqual(detailOf(binary, { Text: null, Payload: binary.Payload }, "text"), {
    text: "ff 00 10",
    language: null,
    note: "No text form; shown as hex",
  });
  assert.equal(detailOf(msg({ Payload: b64(proto) }), { Text: "1:VARINT 1", Payload: b64(proto) }, "raw").text.startsWith("08 01 12 06"), true);
});

test("a payload the event left out is marked, and once read in full says so", () => {
  const m = msg({ PayloadTruncated: true });
  assert.equal(messageSize(m), "over 64 KB");
  assert.ok(messageChips(m).some((c) => c.label === "Large"));
  assert.equal(detailOf(m, undefined, "text").note, "Loading the full payload…");
  const whole = b64(Buffer.from("x".repeat(70_000)));
  assert.equal(detailOf(m, { Text: null, Payload: whole, Full: true }, "text").note, "Full payload loaded: too large for the live event");
  assert.equal(messageSize(msg({ Payload: b64(proto) })), "20 B");
});

test("rows are marked injected, edited, held, dropped, compressed, too large or cut short", () => {
  const labels = (metadata, extra = {}) => messageChips(msg({ Metadata: metadata, ...extra })).map((c) => c.label);
  assert.deepEqual(labels({ injected: true }), ["Injected"]);
  assert.deepEqual(labels({ intercepted: true, edited: true }), ["Edited"]);
  assert.deepEqual(labels({ intercepted: true }), ["Held"]);
  assert.deepEqual(labels({ intercepted: true, dropped: true }), ["Dropped"]);
  assert.deepEqual(labels({ encoding: "gzip" }, { Compressed: true }), ["gzip"]);
  assert.deepEqual(labels({ too_large: true, size_seen: 10 }), ["Too large"]);
  assert.deepEqual(labels({ cut_short: true }), ["Cut short"]);
});

test("a gRPC-Web or Connect pair's trailers come from its trailer message", () => {
  const messages = [
    msg({ Framing: "grpc-web", Flags: 0, Payload: b64(proto) }),
    msg({ Framing: "grpc-web", Flags: 128, Payload: b64(Buffer.from("grpc-status: 0\r\ngrpc-message: done\r\n")) }),
  ];
  assert.deepEqual(pairTrailers(messages, "response"), [
    { Name: "grpc-status", Value: "0" },
    { Name: "grpc-message", Value: "done" },
  ]);
  assert.deepEqual(pairTrailers(messages, "request"), []);
});
