import { test } from "node:test";
import assert from "node:assert/strict";
import { StringStream } from "@codemirror/language";
import { http } from "./httpMode.js";

// Each line's tokens as [text, style], blank lines moving to the body.
function tokens(text) {
  const state = http.startState();
  return text.split("\n").map((line) => {
    if (line === "") {
      http.blankLine(state);
      return [];
    }
    const stream = new StringStream(line, 4, 2);
    const out = [];
    while (!stream.eol()) {
      const style = http.token(stream, state);
      out.push([stream.current(), style]);
      stream.start = stream.pos;
    }
    return out;
  });
}

const errors = (text) => tokens(text).flat().filter(([, style]) => style === "error");

test("HTTP/1.1 messages highlight without errors", () => {
  assert.deepEqual(errors("GET /a HTTP/1.1\nHost: shop.test\n\nbody"), []);
  assert.deepEqual(errors("HTTP/1.1 302 Found\nLocation: /\n\n"), []);
});

test("Marasi's HTTP/2 text form highlights without errors", () => {
  assert.deepEqual(errors("GET /a HTTP/2\n:scheme: https\n:authority: shop.test\naccept: */*\n\n"), []);
  assert.deepEqual(errors("HTTP/2 200\n:status: 200\ncontent-type: text/html\n\n"), []);
});

test("a pseudo-header field's name runs to the colon after its first character", () => {
  const [, authority] = tokens("GET / HTTP/2\n:authority: shop.test");
  assert.deepEqual(authority[0], [":authority:", "atom"]);
});

test("a broken start line is still an error", () => {
  assert.equal(errors("GET / HTTP/x\n\n").length, 1);
  assert.equal(errors("HTTP/2x 200\n\n").length, 1);
});
