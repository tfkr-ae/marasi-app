import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyResponse } from "./classify.js";

const enc = (s) => new TextEncoder().encode(s);

test("specific Content-Type wins with nosniff semantics", () => {
  assert.deepEqual(
    classifyResponse({ contentType: "text/html; charset=utf-8", bodyBytes: enc("hello") }),
    { kind: "html", mime: "text/html", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "application/xhtml+xml", bodyBytes: enc("<html/>") }),
    { kind: "html", mime: "application/xhtml+xml", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "image/svg+xml", bodyBytes: enc("<svg/>") }),
    { kind: "svg", mime: "image/svg+xml", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "image/png", bodyBytes: Uint8Array.from([1, 2, 3]) }),
    { kind: "image", mime: "image/png", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "video/mp4", bodyBytes: Uint8Array.from([1, 2, 3]) }),
    { kind: "video", mime: "video/mp4", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "audio/mpeg", bodyBytes: Uint8Array.from([1, 2, 3]) }),
    { kind: "audio", mime: "audio/mpeg", sniffed: false },
  );
});

test("text/plain containing HTML markup stays unsupported (nosniff)", () => {
  assert.deepEqual(
    classifyResponse({ contentType: "text/plain; charset=utf-8", bodyBytes: enc("<html><script>alert(1)</script></html>") }),
    { kind: "unsupported", mime: "text/plain", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "application/json", bodyBytes: enc('{"a":1}') }),
    { kind: "unsupported", mime: "application/json", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "application/pdf", bodyBytes: enc("%PDF-1.7") }),
    { kind: "unsupported", mime: "application/pdf", sniffed: false },
  );
});

test("missing or generic Content-Type sniffs binary image, video, and audio magic bytes", () => {
  const cases = [
    ["PNG", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), "image", "image/png"],
    ["JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image", "image/jpeg"],
    ["GIF", enc("GIF89a\x01\x00"), "image", "image/gif"],
    ["WebP", enc("RIFF1234WEBP"), "image", "image/webp"],
    ["AVIF", Uint8Array.from([0, 0, 0, 20, ...enc("ftypavif")]), "image", "image/avif"],
    ["MP4", Uint8Array.from([0, 0, 0, 20, ...enc("ftypisom")]), "video", "video/mp4"],
    ["M4A", Uint8Array.from([0, 0, 0, 20, ...enc("ftypM4A ")]), "audio", "audio/mp4"],
    ["WebM", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]), "video", "video/webm"],
    ["WAV", enc("RIFF1234WAVE"), "audio", "audio/wav"],
    ["MP3", enc("ID3\x03\x00"), "audio", "audio/mpeg"],
    ["Ogg audio", enc("OggS\x00\x02opus"), "audio", "audio/ogg"],
    ["FLAC", enc("fLaC\x00\x00"), "audio", "audio/flac"],
  ];

  for (const [label, bytes, kind, mime] of cases) {
    assert.deepEqual(
      classifyResponse({ contentType: "application/octet-stream", bodyBytes: bytes }),
      { kind, mime, sniffed: true },
      label,
    );
    assert.deepEqual(
      classifyResponse({ contentType: "", bodyBytes: bytes }),
      { kind, mime, sniffed: true },
      `${label} (no header)`,
    );
  }
});

test("missing or generic Content-Type sniffs SVG and HTML markup, but rejects plain text and JSON", () => {
  assert.deepEqual(
    classifyResponse({ contentType: "", bodyBytes: enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }),
    { kind: "svg", mime: "image/svg+xml", sniffed: true },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "application/octet-stream", bodyBytes: enc('<?xml version="1.0"?><svg></svg>') }),
    { kind: "svg", mime: "image/svg+xml", sniffed: true },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "", bodyBytes: enc("<!doctype html><html><body>Hi</body></html>") }),
    { kind: "html", mime: "text/html", sniffed: true },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "", bodyBytes: enc('{"hello":"world"}') }),
    { kind: "unsupported", mime: "", sniffed: false },
  );
  assert.deepEqual(
    classifyResponse({ contentType: "application/octet-stream", bodyBytes: enc("plain text") }),
    { kind: "unsupported", mime: "application/octet-stream", sniffed: false },
  );
});
