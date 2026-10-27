import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactBytes, artifactText, formatSize, previewOf } from "./artifacts.js";

const art = (MimeType, Filename = "file") => ({ MimeType, Filename });

test("an artifact previews by its content type", () => {
  assert.equal(previewOf(art("image/png")), "image");
  assert.equal(previewOf(art("video/mp4")), "video");
  assert.equal(previewOf(art("application/pdf")), "pdf");
  for (const mime of [
    "text/plain",
    "text/csv",
    "application/json",
    "application/har+json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
  ])
    assert.equal(previewOf(art(mime)), "text", mime);
  assert.equal(previewOf(art("application/zip")), "file");
});

test("with no useful content type, the file name's extension decides", () => {
  assert.equal(previewOf(art("", "traffic.har")), "text");
  assert.equal(previewOf(art("application/octet-stream", "config.YML")), "text");
  assert.equal(previewOf(art("application/octet-stream", "shot.png")), "image");
  assert.equal(previewOf(art("application/octet-stream", "report.pdf")), "pdf");
  assert.equal(previewOf(art("application/octet-stream", "dump.bin")), "file");
  assert.equal(previewOf(art(undefined, undefined)), "file");
});

test("artifact bytes come from Go's base64", () => {
  assert.deepEqual([...artifactBytes("aGk=")], [104, 105]);
  assert.deepEqual([...artifactBytes([1, 2])], [1, 2]);
  assert.deepEqual([...artifactBytes(null)], []);
});

const utf8 = (text) => new TextEncoder().encode(text);

test("JSON and HAR read pretty-printed; other text as it is", () => {
  assert.equal(artifactText(utf8('{"a":[1]}'), art("application/json")), '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(artifactText(utf8('{"log":{}}'), art("", "x.har")), '{\n  "log": {}\n}');
  assert.equal(artifactText(utf8("{not json"), art("application/json")), "{not json");
  assert.equal(artifactText(utf8("a,b\n1,2"), art("text/csv")), "a,b\n1,2");
  assert.equal(artifactText(utf8("café"), art("text/plain")), "café");
});

test("sizes read in B, KB or MB", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(1536 * 1024), "1.5 MB");
  assert.equal(formatSize(undefined), "0 B");
});
