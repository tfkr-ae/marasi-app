import { test } from "node:test";
import assert from "node:assert/strict";
import { toDetails } from "./trafficApi.js";

test("toDetails preserves exact Response.RawBytes alongside UTF-8 Response.Raw", () => {
  const head = Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n", "ascii");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
  const raw = Buffer.concat([head, png]);

  const details = toDetails({
    id: "p1",
    number: 1,
    request: { method: "GET", host: "example.com", path: "/img.png", raw: Buffer.from("GET /img.png HTTP/1.1\r\n\r\n").toString("base64") },
    response: { status: "200 OK", status_code: 200, content_type: "image/png", length: png.length, raw: raw.toString("base64") },
  });

  assert.ok(details.Response.RawBytes instanceof Uint8Array);
  assert.deepEqual([...details.Response.RawBytes], [...raw]);
  assert.ok(details.Response.Raw.startsWith("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n"));
});

test("toDetails sets Response.RawBytes to null when response.raw is absent or empty", () => {
  const details = toDetails({
    id: "p2",
    number: 2,
    request: { method: "GET", host: "example.com", path: "/pending" },
    response: {},
  });
  assert.equal(details.Response.RawBytes, null);
  assert.equal(details.Response.Raw, "");
});
