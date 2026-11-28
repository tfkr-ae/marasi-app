import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import { HighlightStyle, ensureSyntaxTree, foldable } from "@codemirror/language";
import { classHighlighter, highlightTree, tags as t } from "@lezer/highlight";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { githubLightStyle } from "@uiw/codemirror-theme-github";
import { SYNTAX_AUTO_LIMIT, httpHighlighting } from "./httpHighlight.js";
import { LONG_STRING_LIMIT, foldedLongStrings, longStrings } from "./longStrings.js";

const githubLightHighlightStyle = HighlightStyle.define(githubLightStyle);

function highlightSpans(doc, opts = {}) {
  const mode = "mode" in opts ? opts.mode : "auto";
  const highlighter = opts.highlighter ?? classHighlighter;
  const state = EditorState.create({ doc, extensions: httpHighlighting({ mode }) });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) return [];
  const spans = [];
  highlightTree(tree, highlighter, (from, to, classes) => {
    spans.push({ from, to, text: doc.slice(from, to), classes });
  });
  return spans;
}

function classFor(doc, needle, options = {}) {
  const { fromIndex = 0 } = options;
  const from = doc.indexOf(needle, fromIndex);
  assert.ok(from >= 0, `needle ${JSON.stringify(needle)} not found in doc`);
  const to = from + needle.length;
  const spans = highlightSpans(doc, options);
  const matching = spans.filter((s) => s.from <= from && s.to >= to);
  return matching.length ? matching[0].classes : null;
}

test("HTTP/1.1 request and response heads highlight with exact semantic token roles", () => {
  const req = "POST /api/v1/items?x=1 HTTP/1.1\nHost: shop.test\nX-Note: hello\n continued\n\n";
  assert.equal(classFor(req, "POST"), "tok-keyword");
  assert.equal(classFor(req, "/api/v1/items?x=1"), "tok-string2");
  assert.equal(classFor(req, "HTTP/1.1"), "tok-keyword");
  assert.equal(classFor(req, "Host:"), "tok-atom");
  assert.equal(classFor(req, " shop.test"), "tok-string");
  assert.equal(classFor(req, " continued"), "tok-string");

  const ok = "HTTP/1.1 200 OK\nLocation: /\n\n";
  assert.equal(classFor(ok, "HTTP/1.1"), "tok-keyword");
  assert.equal(classFor(ok, "200"), "tok-atom");
  assert.equal(classFor(ok, "OK"), null);
  assert.equal(classFor(ok, "Location:"), "tok-atom");
  assert.equal(classFor(ok, " /"), "tok-string");

  const redir = "HTTP/1.1 302 Found\n\n";
  assert.equal(classFor(redir, "302"), "tok-atom");

  const clientErr = "HTTP/1.1 404 Not Found\n\n";
  assert.equal(classFor(clientErr, "404"), "tok-invalid");

  const serverErr = "HTTP/1.1 503 Service Unavailable\n\n";
  assert.equal(classFor(serverErr, "503"), "tok-invalid");

  // Both real themes assign distinct classes to head roles (not null)
  for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
    assert.ok(classFor(req, "POST", { highlighter }), "method styled in theme");
    assert.ok(classFor(req, "Host:", { highlighter }), "header name styled in theme");
    assert.ok(classFor(req, " shop.test", { highlighter }), "header value styled in theme");
    assert.ok(classFor(clientErr, "404", { highlighter }), "4xx status styled in theme");
  }
});

test("malformed HTTP start lines and header lines highlight as invalid", () => {
  assert.equal(classFor("GET / HTTP/x\n\n", "HTTP/x"), "tok-invalid");
  assert.equal(classFor("HTTP/2x 200\n\n", "HTTP/2x 200"), "tok-invalid");
  assert.equal(classFor("HTTP/1.1 nope\n\n", "nope"), "tok-invalid");
  assert.equal(classFor("GET / HTTP/1.1\nNotAHeader\n\n", "NotAHeader"), "tok-invalid");
});

test("Marasi's HTTP/2 text form highlights without errors and preserves pseudo-header boundaries", () => {
  const req = "GET /a HTTP/2\n:scheme: https\n:authority: shop.test\naccept: */*\n\n";
  assert.equal(classFor(req, "GET"), "tok-keyword");
  assert.equal(classFor(req, "/a"), "tok-string2");
  assert.equal(classFor(req, "HTTP/2"), "tok-keyword");
  assert.equal(classFor(req, ":scheme:"), "tok-atom");
  assert.equal(classFor(req, " https"), "tok-string");
  assert.equal(classFor(req, ":authority:"), "tok-atom");
  assert.equal(classFor(req, " shop.test"), "tok-string");
  assert.equal(classFor(req, "accept:"), "tok-atom");
  assert.equal(
    highlightSpans(req).filter((s) => s.classes.includes("tok-invalid")).length,
    0,
  );

  const res = "HTTP/2 200\n:status: 200\ncontent-type: text/plain\n\n";
  assert.equal(classFor(res, "HTTP/2"), "tok-keyword");
  assert.equal(classFor(res, "200"), "tok-atom");
  assert.equal(classFor(res, ":status:"), "tok-atom");
  assert.equal(classFor(res, " 200", { fromIndex: res.indexOf(":status:") }), "tok-string");

  assert.equal(classFor("GET / HTTP/2\n:broken\n\n", ":broken"), "tok-invalid");
});

test("JSON and *+json bodies highlight via parseMixed regardless of header casing or parameters", () => {
  const cases = [
    "HTTP/1.1 200 OK\nContent-Type: application/json\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/json; charset=utf-8\n\n",
    "HTTP/2 200\n:status: 200\ncontent-type: text/json\n\n",
    "HTTP/1.1 400 Bad Request\nCONTENT-TYPE: application/problem+json; charset=UTF-8\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/vnd.api+json\n\n",
  ];
  const body = '{"id": 42, "ok": true, "name": "marasi", "empty": null}';
  for (const head of cases) {
    const doc = head + body;
    assert.equal(classFor(doc, '"id"'), "tok-propertyName", `propertyName for ${head}`);
    assert.equal(classFor(doc, "42"), "tok-number", `number for ${head}`);
    assert.equal(classFor(doc, "true"), "tok-bool", `bool for ${head}`);
    assert.equal(classFor(doc, '"marasi"'), "tok-string", `string for ${head}`);
    assert.equal(classFor(doc, "null"), "tok-keyword", `null for ${head}`);

    for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
      assert.ok(classFor(doc, '"id"', { highlighter }), `propertyName styled in theme for ${head}`);
      assert.ok(classFor(doc, "42", { highlighter }), `number styled in theme for ${head}`);
      assert.ok(classFor(doc, '"marasi"', { highlighter }), `string styled in theme for ${head}`);
    }
  }

  // Non-JSON content type stays unhighlighted in body
  const plain = "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nhello world";
  assert.equal(classFor(plain, "hello world"), null);

  // Empty document and empty body highlight cleanly without error
  assert.deepEqual(highlightSpans(""), []);
  const noContent = "HTTP/1.1 204 No Content\nContent-Type: application/json\n\n";
  assert.equal(classFor(noContent, "204"), "tok-atom");
  assert.equal(classFor(noContent, "Content-Type:"), "tok-atom");
});

test("JSON body highlighting adds no fold ranges or auto-closing bracket languageData", () => {
  const doc = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{\n  "items": [\n    1,\n    2\n  ]\n}';
  const state = EditorState.create({ doc, extensions: httpHighlighting({ mode: "auto" }) });
  ensureSyntaxTree(state, doc.length, 5000);

  const bodyStart = doc.indexOf("\n\n") + 2;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    assert.equal(foldable(state, line.from, line.to), null, `line ${n} must not be foldable`);
  }
  assert.deepEqual(state.languageDataAt("closeBrackets", bodyStart + 2), []);
  assert.deepEqual(state.languageDataAt("indentOnInput", bodyStart + 2), []);
});

test("broken, truncated, or fuzzed JSON produces no invalid spans in body while broken head lines do", () => {
  const oneDarkInvalid = oneDarkHighlightStyle.style([t.invalid]);
  const githubLightInvalid = githubLightHighlightStyle.style([t.invalid]);
  assert.ok(oneDarkInvalid, "oneDark defines invalid class");
  assert.ok(githubLightInvalid, "githubLight defines invalid class");

  const brokenBodies = [
    '{"a": 1, "b": [1, 2,',
    '{invalid: ???, "ok": "yes"}',
    '{"unclosed": "str',
    '[{"x": true}, ,,, ]',
  ];

  for (const body of brokenBodies) {
    const doc = `GET / HTTP/x\nContent-Type: application/json\n\n${body}`;
    const bodyStart = doc.indexOf("\n\n") + 2;

    const classSpans = highlightSpans(doc, { highlighter: classHighlighter });
    const headInvalids = classSpans.filter((s) => s.to <= bodyStart && s.classes.includes("tok-invalid"));
    const bodyInvalids = classSpans.filter((s) => s.from >= bodyStart && s.classes.includes("tok-invalid"));
    assert.ok(headInvalids.length > 0, `expected invalid head span for ${body}`);
    assert.deepEqual(bodyInvalids, [], `expected no invalid body spans for ${body}`);

    for (const [name, highlighter, invalidCls] of [
      ["oneDark", oneDarkHighlightStyle, oneDarkInvalid],
      ["githubLight", githubLightHighlightStyle, githubLightInvalid],
    ]) {
      const spans = highlightSpans(doc, { highlighter });
      const headErr = spans.filter((s) => s.to <= bodyStart && s.classes.split(" ").includes(invalidCls));
      const bodyErr = spans.filter((s) => s.from >= bodyStart && s.classes.split(" ").includes(invalidCls));
      assert.ok(headErr.length > 0, `${name}: expected invalid head span`);
      assert.deepEqual(bodyErr, [], `${name}: expected zero invalid body spans for ${body}`);
    }
  }

  // Valid tokens around broken JSON still highlight
  const partial = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"ok": "yes", "broken": }';
  assert.equal(classFor(partial, '"ok"'), "tok-propertyName");
  assert.equal(classFor(partial, '"yes"'), "tok-string");
});

test("live edits to Content-Type or body immediately update highlighting", () => {
  const initial = 'HTTP/1.1 200 OK\nContent-Type: text/plain\n\n{"id": 7}';
  let state = EditorState.create({ doc: initial, extensions: httpHighlighting({ mode: "auto" }) });

  const spansOf = (st) => {
    const tree = ensureSyntaxTree(st, st.doc.length, 5000);
    const out = [];
    if (!tree) return out;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      out.push({ from, to, text: st.doc.sliceString(from, to), classes });
    });
    return out;
  };

  assert.equal(spansOf(state).some((s) => s.text === '"id"' && s.classes === "tok-propertyName"), false);

  const ctFrom = initial.indexOf("text/plain");
  state = state.update({ changes: { from: ctFrom, to: ctFrom + "text/plain".length, insert: "application/json" } }).state;
  assert.equal(spansOf(state).some((s) => s.text === '"id"' && s.classes === "tok-propertyName"), true);
  assert.equal(spansOf(state).some((s) => s.text === "7" && s.classes === "tok-number"), true);

  // Edit inside JSON body
  const numPos = state.doc.toString().indexOf("7");
  state = state.update({ changes: { from: numPos, to: numPos + 1, insert: "true" } }).state;
  assert.equal(spansOf(state).some((s) => s.text === "true" && s.classes === "tok-bool"), true);

  // Switch Content-Type back to text/plain
  const jsonPos = state.doc.toString().indexOf("application/json");
  state = state.update({ changes: { from: jsonPos, to: jsonPos + "application/json".length, insert: "text/plain" } }).state;
  assert.equal(spansOf(state).some((s) => s.text === '"id"' && s.classes === "tok-propertyName"), false);
});

test("SyntaxMode controls head and body highlighting and supports live reconfiguration", () => {
  const head = "HTTP/1.1 200 OK\nContent-Type: application/json\n\n";
  // Build a JSON body right at the 75,000-char boundary and one just below it
  const smallBody = `{"k":"${"a".repeat(SYNTAX_AUTO_LIMIT - 9)}"}`; // length = SYNTAX_AUTO_LIMIT - 1
  const largeBody = `{"k":"${"a".repeat(SYNTAX_AUTO_LIMIT - 8)}"}`; // length = SYNTAX_AUTO_LIMIT
  assert.equal(smallBody.length, SYNTAX_AUTO_LIMIT - 1);
  assert.equal(largeBody.length, SYNTAX_AUTO_LIMIT);

  const smallDoc = head + smallBody;
  const largeDoc = head + largeBody;

  // disabled & undefined highlight nothing
  assert.deepEqual(highlightSpans(smallDoc, { mode: "disabled" }), []);
  assert.deepEqual(highlightSpans(smallDoc, { mode: undefined }), []);

  // auto highlights head + body below SYNTAX_AUTO_LIMIT
  assert.equal(classFor(smallDoc, "HTTP/1.1", { mode: "auto" }), "tok-keyword");
  assert.equal(classFor(smallDoc, '"k"', { mode: "auto" }), "tok-propertyName");

  // auto keeps head highlighted at >= SYNTAX_AUTO_LIMIT while skipping body
  assert.equal(classFor(largeDoc, "HTTP/1.1", { mode: "auto" }), "tok-keyword");
  assert.equal(classFor(largeDoc, "Content-Type:", { mode: "auto" }), "tok-atom");
  assert.equal(classFor(largeDoc, '"k"', { mode: "auto" }), null);

  // enabled highlights both head and body regardless of length
  assert.equal(classFor(largeDoc, "HTTP/1.1", { mode: "enabled" }), "tok-keyword");
  assert.equal(classFor(largeDoc, '"k"', { mode: "enabled" }), "tok-propertyName");

  // Live reconfiguration via StateEffect.reconfigure
  let state = EditorState.create({ doc: largeDoc, extensions: httpHighlighting({ mode: "disabled" }) });
  assert.equal(ensureSyntaxTree(state, largeDoc.length, 5000), null);

  state = state.update({ effects: StateEffect.reconfigure.of(httpHighlighting({ mode: "auto" })) }).state;
  const autoTree = ensureSyntaxTree(state, largeDoc.length, 5000);
  const autoSpans = [];
  highlightTree(autoTree, classHighlighter, (from, to, classes) => autoSpans.push({ from, to, classes }));
  assert.ok(autoSpans.some((s) => s.from === 0 && s.classes === "tok-keyword"), "auto highlights head");
  assert.equal(autoSpans.some((s) => s.classes === "tok-propertyName"), false, "auto skips large body");

  state = state.update({ effects: StateEffect.reconfigure.of(httpHighlighting({ mode: "enabled" })) }).state;
  const enabledTree = ensureSyntaxTree(state, largeDoc.length, 5000);
  const enabledSpans = [];
  highlightTree(enabledTree, classHighlighter, (from, to, classes) => enabledSpans.push({ from, to, classes }));
  assert.ok(enabledSpans.some((s) => s.classes === "tok-propertyName"), "enabled highlights large body");
});

test("HTTP JSON highlighting coexists cleanly with long-string folding", () => {
  const head = "HTTP/1.1 200 OK\nContent-Type: application/json\n\n";
  const blob = "QUJD".repeat(Math.ceil(LONG_STRING_LIMIT / 4));
  const doc = `${head}{"name":"file.pdf","data":"${blob}"}`;
  const blobStart = doc.indexOf(blob);

  const state = EditorState.create({
    doc,
    extensions: [...httpHighlighting({ mode: "auto" }), ...longStrings({ wrap: true, mode: "auto" })],
  });

  assert.deepEqual(foldedLongStrings(state), [{ from: blobStart, to: blobStart + blob.length }]);
  assert.equal(state.doc.sliceString(blobStart, blobStart + blob.length), blob);

  const tree = ensureSyntaxTree(state, doc.length, 5000);
  const spans = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    spans.push({ text: doc.slice(from, to), classes });
  });
  assert.ok(spans.some((s) => s.text === "HTTP/1.1" && s.classes === "tok-keyword"));
  assert.ok(spans.some((s) => s.text === '"name"' && s.classes === "tok-propertyName"));
  assert.ok(spans.some((s) => s.text === '"file.pdf"' && s.classes === "tok-string"));
  assert.ok(spans.some((s) => s.text === '"data"' && s.classes === "tok-propertyName"));
});
