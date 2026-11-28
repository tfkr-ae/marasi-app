import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import { ensureSyntaxTree, foldable } from "@codemirror/language";
import { classHighlighter, highlightTree, tags as t } from "@lezer/highlight";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { SYNTAX_AUTO_LIMIT, httpHighlighting } from "./httpHighlight.js";
import { LONG_STRING_LIMIT, foldedLongStrings, longStrings } from "./longStrings.js";
import { classFor, githubLightHighlightStyle, highlightSpans } from "./httpHighlight/testHelpers.js";

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
  const initial = "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nconst id = 7;";
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

  assert.equal(spansOf(state).some((s) => s.text === "const" && s.classes === "tok-keyword"), false);

  const ctFrom = initial.indexOf("text/plain");
  state = state.update({ changes: { from: ctFrom, to: ctFrom + "text/plain".length, insert: "application/javascript" } }).state;
  assert.equal(spansOf(state).some((s) => s.text === "const" && s.classes === "tok-keyword"), true);
  assert.equal(spansOf(state).some((s) => s.text === "7" && s.classes === "tok-number"), true);

  // Edit inside JS body
  const numPos = state.doc.toString().indexOf("7");
  state = state.update({ changes: { from: numPos, to: numPos + 1, insert: "true" } }).state;
  assert.equal(spansOf(state).some((s) => s.text === "true" && s.classes === "tok-bool"), true);

  // Switch Content-Type back to text/plain
  const jsPos = state.doc.toString().indexOf("application/javascript");
  state = state.update({ changes: { from: jsPos, to: jsPos + "application/javascript".length, insert: "text/plain" } }).state;
  assert.equal(spansOf(state).some((s) => s.text === "const" && s.classes === "tok-keyword"), false);
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

test("HTML and XHTML bodies highlight markup, embedded <script> JS, and embedded <style> CSS", () => {
  const body = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    "  <style>body { color: #ff0000; }</style>",
    "  <script>const count = 42; return count;</script>",
    "</head>",
    '<body><!-- note --><a href="/home" onclick="alert(1)" style="margin: 0">Hi &amp; bye</a></body>',
    "</html>",
  ].join("\n");

  const heads = [
    "HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\n\n",
    "HTTP/2 200\n:status: 200\ncontent-type: application/xhtml+xml\n\n",
  ];

  for (const head of heads) {
    const doc = head + body;
    // HTML markup
    assert.equal(classFor(doc, "html", { fromIndex: doc.indexOf("<html") }), "tok-typeName");
    assert.equal(classFor(doc, "href"), "tok-propertyName");
    assert.equal(classFor(doc, '"/home"'), "tok-string");
    assert.equal(classFor(doc, "<!-- note -->"), "tok-comment");
    assert.equal(classFor(doc, "&amp;"), "tok-string");

    // Embedded <style> CSS
    assert.equal(classFor(doc, "color", { fromIndex: doc.indexOf("<style>") }), "tok-propertyName");
    assert.equal(classFor(doc, "#ff0000"), "tok-literal");

    // Embedded <script> JS
    assert.equal(classFor(doc, "const", { fromIndex: doc.indexOf("<script>") }), "tok-keyword");
    assert.equal(classFor(doc, "42", { fromIndex: doc.indexOf("<script>") }), "tok-number");
    assert.equal(classFor(doc, "return", { fromIndex: doc.indexOf("<script>") }), "tok-keyword");

    // Both light and dark themes style HTML, embedded JS, and embedded CSS
    for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
      assert.ok(classFor(doc, "href", { highlighter }), "HTML attribute styled");
      assert.ok(classFor(doc, "const", { fromIndex: doc.indexOf("<script>"), highlighter }), "embedded JS keyword styled");
      assert.ok(classFor(doc, "color", { fromIndex: doc.indexOf("<style>"), highlighter }), "embedded CSS property styled");
    }
  }
});

test("HTML bodies including embedded <script> and <style> add no folds or closeBrackets and recover without invalid spans", () => {
  const oneDarkInvalid = oneDarkHighlightStyle.style([t.invalid]);
  const githubLightInvalid = githubLightHighlightStyle.style([t.invalid]);

  const foldableHtml = [
    "HTTP/1.1 200 OK",
    "Content-Type: text/html",
    "",
    "<div>",
    "  <script>",
    "    function f() {",
    "      return [1, 2];",
    "    }",
    "  </script>",
    "  <style>",
    "    .box {",
    "      color: red;",
    "    }",
    "  </style>",
    '  <button onclick="fn()" style="color: blue">Go</button>',
    "</div>",
  ].join("\n");

  const state = EditorState.create({ doc: foldableHtml, extensions: httpHighlighting({ mode: "auto" }) });
  ensureSyntaxTree(state, foldableHtml.length, 5000);

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    assert.equal(foldable(state, line.from, line.to), null, `HTML line ${n} must not be foldable`);
  }
  for (const probe of ["<div>", "function f()", "color: red;", "fn()", "color: blue"]) {
    const pos = foldableHtml.indexOf(probe) + 2;
    assert.deepEqual(state.languageDataAt("closeBrackets", pos), [], `no closeBrackets at ${probe}`);
    assert.deepEqual(state.languageDataAt("indentOnInput", pos), [], `no indentOnInput at ${probe}`);
  }

  const brokenBodies = [
    "<div><span></wrong><p attr=",
    "<script>const x = {{{ ;;;</script><style>body { color: ;;; </style>",
    "<html><body><a href='unterminated",
  ];
  for (const body of brokenBodies) {
    const doc = `GET / HTTP/x\nContent-Type: text/html\n\n${body}`;
    const bodyStart = doc.indexOf("\n\n") + 2;

    const classSpans = highlightSpans(doc);
    assert.ok(classSpans.some((s) => s.to <= bodyStart && s.classes.includes("tok-invalid")));
    assert.deepEqual(
      classSpans.filter((s) => s.from >= bodyStart && s.classes.includes("tok-invalid")),
      [],
      `expected zero invalid spans in broken HTML: ${body}`,
    );

    for (const [name, highlighter, invalidCls] of [
      ["oneDark", oneDarkHighlightStyle, oneDarkInvalid],
      ["githubLight", githubLightHighlightStyle, githubLightInvalid],
    ]) {
      const spans = highlightSpans(doc, { highlighter });
      assert.deepEqual(
        spans.filter((s) => s.from >= bodyStart && s.classes.split(" ").includes(invalidCls)),
        [],
        `${name}: expected zero invalid spans in broken HTML: ${body}`,
      );
    }
  }
});

test("XML and *+xml bodies highlight elements, attributes, processing instructions, comments, and CDATA", () => {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="16">',
    "  <!-- icon -->",
    "  <desc><![CDATA[raw <text>]]></desc>",
    "</svg>",
  ].join("\n");

  const heads = [
    "HTTP/1.1 200 OK\nContent-Type: application/xml\n\n",
    "HTTP/1.1 200 OK\nContent-Type: text/xml; charset=utf-8\n\n",
    "HTTP/1.1 200 OK\nContent-Type: image/svg+xml\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/soap+xml; charset=utf-8\n\n",
    "HTTP/2 200\n:status: 200\ncontent-type: application/atom+xml\n\n",
  ];

  for (const head of heads) {
    const doc = head + body;
    assert.equal(classFor(doc, '<?xml version="1.0" encoding="UTF-8"?>'), "tok-meta", `PI for ${head}`);
    assert.equal(classFor(doc, "svg", { fromIndex: doc.indexOf("<svg") }), "tok-typeName", `tag for ${head}`);
    assert.equal(classFor(doc, "width"), "tok-propertyName", `attr name for ${head}`);
    assert.equal(classFor(doc, '"16"'), "tok-string", `attr val for ${head}`);
    assert.equal(classFor(doc, "<!-- icon -->"), "tok-comment", `comment for ${head}`);
    assert.equal(classFor(doc, "<![CDATA[raw <text>]]>"), "tok-string2", `cdata for ${head}`);

    for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
      assert.ok(classFor(doc, "svg", { fromIndex: doc.indexOf("<svg"), highlighter }), `tag styled for ${head}`);
      assert.ok(classFor(doc, "width", { highlighter }), `attr styled for ${head}`);
      assert.ok(classFor(doc, '"16"', { highlighter }), `attr val styled for ${head}`);
    }
  }
});

test("XML bodies add no folds or closeBrackets and recover permissively on broken/mismatched markup", () => {
  const oneDarkInvalid = oneDarkHighlightStyle.style([t.invalid]);
  const githubLightInvalid = githubLightHighlightStyle.style([t.invalid]);

  const doc = [
    "HTTP/1.1 200 OK",
    "Content-Type: application/xml",
    "",
    "<envelope>",
    "  <body>",
    '    <item id="1">ok</item>',
    "  </body>",
    "</envelope>",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: httpHighlighting({ mode: "auto" }) });
  ensureSyntaxTree(state, doc.length, 5000);

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    assert.equal(foldable(state, line.from, line.to), null, `XML line ${n} must not be foldable`);
  }
  const itemPos = doc.indexOf("<item") + 2;
  assert.deepEqual(state.languageDataAt("closeBrackets", itemPos), []);
  assert.deepEqual(state.languageDataAt("indentOnInput", itemPos), []);

  const brokenBodies = [
    "<root><item></wrong>",
    '<?xml version="1.0"?><feed><entry id="1"',
    "<soap:Envelope><soap:Body><unclosed attr=",
  ];
  for (const body of brokenBodies) {
    const brokenDoc = `GET / HTTP/x\nContent-Type: application/soap+xml\n\n${body}`;
    const bodyStart = brokenDoc.indexOf("\n\n") + 2;

    const classSpans = highlightSpans(brokenDoc);
    assert.ok(classSpans.some((s) => s.to <= bodyStart && s.classes.includes("tok-invalid")));
    assert.deepEqual(
      classSpans.filter((s) => s.from >= bodyStart && s.classes.includes("tok-invalid")),
      [],
      `expected zero invalid spans in broken XML: ${body}`,
    );

    for (const [name, highlighter, invalidCls] of [
      ["oneDark", oneDarkHighlightStyle, oneDarkInvalid],
      ["githubLight", githubLightHighlightStyle, githubLightInvalid],
    ]) {
      const spans = highlightSpans(brokenDoc, { highlighter });
      assert.deepEqual(
        spans.filter((s) => s.from >= bodyStart && s.classes.split(" ").includes(invalidCls)),
        [],
        `${name}: expected zero invalid spans in broken XML: ${body}`,
      );
    }
  }
});

test("JavaScript bodies highlight across text/javascript, application/javascript, and application/x-javascript", () => {
  const body = [
    "// handler",
    'export async function fetchItem(id) {',
    '  const url = "/api/" + id;',
    "  return { ok: true, retries: 3 };",
    "}",
  ].join("\n");

  const heads = [
    "HTTP/1.1 200 OK\nContent-Type: text/javascript; charset=utf-8\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/javascript\n\n",
    "HTTP/2 200\n:status: 200\ncontent-type: application/x-javascript\n\n",
  ];

  for (const head of heads) {
    const doc = head + body;
    assert.equal(classFor(doc, "// handler"), "tok-comment");
    assert.equal(classFor(doc, "export"), "tok-keyword");
    assert.equal(classFor(doc, "function"), "tok-keyword");
    assert.equal(classFor(doc, '"/api/"'), "tok-string");
    assert.equal(classFor(doc, "true"), "tok-bool");
    assert.equal(classFor(doc, "3"), "tok-number");

    for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
      assert.ok(classFor(doc, "function", { highlighter }), `keyword styled for ${head}`);
      assert.ok(classFor(doc, '"/api/"', { highlighter }), `string styled for ${head}`);
      assert.ok(classFor(doc, "3", { highlighter }), `number styled for ${head}`);
    }
  }
});

test("JavaScript bodies add no folds or closeBrackets and recover permissively on broken/truncated code", () => {
  const oneDarkInvalid = oneDarkHighlightStyle.style([t.invalid]);
  const githubLightInvalid = githubLightHighlightStyle.style([t.invalid]);

  const doc = [
    "HTTP/1.1 200 OK",
    "Content-Type: application/javascript",
    "",
    "function run() {",
    "  const list = [1, 2, 3];",
    "  return list;",
    "}",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: httpHighlighting({ mode: "auto" }) });
  ensureSyntaxTree(state, doc.length, 5000);

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    assert.equal(foldable(state, line.from, line.to), null, `JS line ${n} must not be foldable`);
  }
  const bodyPos = doc.indexOf("const list") + 2;
  assert.deepEqual(state.languageDataAt("closeBrackets", bodyPos), []);
  assert.deepEqual(state.languageDataAt("indentOnInput", bodyPos), []);

  const brokenBodies = [
    "const x = [1, 2, ;;; function (",
    'const msg = "unterminated',
    "return {{{ ) ] }",
  ];
  for (const body of brokenBodies) {
    const brokenDoc = `GET / HTTP/x\nContent-Type: text/javascript\n\n${body}`;
    const bodyStart = brokenDoc.indexOf("\n\n") + 2;

    const classSpans = highlightSpans(brokenDoc);
    assert.ok(classSpans.some((s) => s.to <= bodyStart && s.classes.includes("tok-invalid")));
    assert.deepEqual(
      classSpans.filter((s) => s.from >= bodyStart && s.classes.includes("tok-invalid")),
      [],
      `expected zero invalid spans in broken JS: ${body}`,
    );

    for (const [name, highlighter, invalidCls] of [
      ["oneDark", oneDarkHighlightStyle, oneDarkInvalid],
      ["githubLight", githubLightHighlightStyle, githubLightInvalid],
    ]) {
      const spans = highlightSpans(brokenDoc, { highlighter });
      assert.deepEqual(
        spans.filter((s) => s.from >= bodyStart && s.classes.split(" ").includes(invalidCls)),
        [],
        `${name}: expected zero invalid spans in broken JS: ${body}`,
      );
    }
  }
});

test("CSS bodies highlight selectors, properties, values, and comments in light and dark themes", () => {
  const body = [
    "/* theme */",
    "@media (min-width: 640px) {",
    '  .card > a { color: #336699; padding: 12px; content: "ok"; }',
    "}",
  ].join("\n");

  const heads = [
    "HTTP/1.1 200 OK\nContent-Type: text/css; charset=utf-8\n\n",
    "HTTP/2 200\n:status: 200\ncontent-type: text/css\n\n",
  ];

  for (const head of heads) {
    const doc = head + body;
    assert.equal(classFor(doc, "/* theme */"), "tok-comment");
    assert.equal(classFor(doc, "@media"), "tok-keyword");
    assert.equal(classFor(doc, "card"), "tok-className");
    assert.equal(classFor(doc, "color"), "tok-propertyName");
    assert.equal(classFor(doc, "#336699"), "tok-literal");
    assert.equal(classFor(doc, "12", { fromIndex: doc.indexOf("padding") }), "tok-number");
    assert.equal(classFor(doc, '"ok"'), "tok-string");

    for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
      assert.ok(classFor(doc, "@media", { highlighter }), `at-rule styled for ${head}`);
      assert.ok(classFor(doc, "color", { highlighter }), `property styled for ${head}`);
      assert.ok(classFor(doc, '"ok"', { highlighter }), `string styled for ${head}`);
    }
  }
});

test("CSS bodies add no folds or closeBrackets and recover permissively on broken stylesheets", () => {
  const oneDarkInvalid = oneDarkHighlightStyle.style([t.invalid]);
  const githubLightInvalid = githubLightHighlightStyle.style([t.invalid]);

  const doc = [
    "HTTP/1.1 200 OK",
    "Content-Type: text/css",
    "",
    ".panel {",
    "  display: grid;",
    "  gap: 1rem;",
    "}",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: httpHighlighting({ mode: "auto" }) });
  ensureSyntaxTree(state, doc.length, 5000);

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    assert.equal(foldable(state, line.from, line.to), null, `CSS line ${n} must not be foldable`);
  }
  const propPos = doc.indexOf("display") + 2;
  assert.deepEqual(state.languageDataAt("closeBrackets", propPos), []);
  assert.deepEqual(state.languageDataAt("indentOnInput", propPos), []);

  const brokenBodies = [
    ".box { color: ;;; ??? }",
    '@media ( { background: url("unclosed',
    "body { margin: 10px",
  ];
  for (const body of brokenBodies) {
    const brokenDoc = `GET / HTTP/x\nContent-Type: text/css\n\n${body}`;
    const bodyStart = brokenDoc.indexOf("\n\n") + 2;

    const classSpans = highlightSpans(brokenDoc);
    assert.ok(classSpans.some((s) => s.to <= bodyStart && s.classes.includes("tok-invalid")));
    assert.deepEqual(
      classSpans.filter((s) => s.from >= bodyStart && s.classes.includes("tok-invalid")),
      [],
      `expected zero invalid spans in broken CSS: ${body}`,
    );

    for (const [name, highlighter, invalidCls] of [
      ["oneDark", oneDarkHighlightStyle, oneDarkInvalid],
      ["githubLight", githubLightHighlightStyle, githubLightInvalid],
    ]) {
      const spans = highlightSpans(brokenDoc, { highlighter });
      assert.deepEqual(
        spans.filter((s) => s.from >= bodyStart && s.classes.split(" ").includes(invalidCls)),
        [],
        `${name}: expected zero invalid spans in broken CSS: ${body}`,
      );
    }
  }
});

test("URL-encoded form bodies highlight parameter names, =, values, and & distinctly in light and dark themes", () => {
  const body = "user=alice%40example.com&token=abc123==&debug&empty=";
  const heads = [
    "POST /login HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\n",
    "POST /login HTTP/2\n:method: POST\ncontent-type: application/x-www-form-urlencoded; charset=UTF-8\n\n",
  ];

  for (const head of heads) {
    const doc = head + body;
    const bodyStart = head.length;

    // Distinct semantic classes in classHighlighter
    assert.equal(classFor(doc, "user", { fromIndex: bodyStart }), "tok-propertyName");
    assert.equal(classFor(doc, "=", { fromIndex: doc.indexOf("user=") }), "tok-operator");
    assert.equal(classFor(doc, "alice%40example.com", { fromIndex: bodyStart }), "tok-string");
    assert.equal(classFor(doc, "&", { fromIndex: doc.indexOf("&token") }), "tok-atom");
    // Additional '=' inside a value (e.g., base64 padding) stays part of the value
    assert.equal(classFor(doc, "token", { fromIndex: bodyStart }), "tok-propertyName");
    assert.equal(classFor(doc, "abc123==", { fromIndex: bodyStart }), "tok-string");
    // Bare flag without '=' highlights as a parameter name; empty value keeps key and '='
    assert.equal(classFor(doc, "debug", { fromIndex: bodyStart }), "tok-propertyName");
    assert.equal(classFor(doc, "empty", { fromIndex: bodyStart }), "tok-propertyName");

    // In both oneDark and githubLight, all four roles are styled and mutually distinct
    for (const [themeName, highlighter] of [
      ["oneDark", oneDarkHighlightStyle],
      ["githubLight", githubLightHighlightStyle],
    ]) {
      const keyCls = classFor(doc, "user", { fromIndex: bodyStart, highlighter });
      const eqCls = classFor(doc, "=", { fromIndex: doc.indexOf("user="), highlighter });
      const valCls = classFor(doc, "alice%40example.com", { fromIndex: bodyStart, highlighter });
      const ampCls = classFor(doc, "&", { fromIndex: doc.indexOf("&token"), highlighter });
      assert.ok(keyCls && eqCls && valCls && ampCls, `${themeName}: all four form token roles must be styled`);
      assert.equal(
        new Set([keyCls, eqCls, valCls, ampCls]).size,
        4,
        `${themeName}: key, =, value, and & must have 4 distinct classes`,
      );
    }
  }
});

test("URL-encoded form bodies add no folds or closeBrackets and recover permissively on fuzzed input", () => {
  const oneDarkInvalid = oneDarkHighlightStyle.style([t.invalid]);
  const githubLightInvalid = githubLightHighlightStyle.style([t.invalid]);

  const doc = "POST /submit HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\na=1&b=2\n&c=3";
  const state = EditorState.create({ doc, extensions: httpHighlighting({ mode: "auto" }) });
  ensureSyntaxTree(state, doc.length, 5000);

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    assert.equal(foldable(state, line.from, line.to), null, `form line ${n} must not be foldable`);
  }
  const bodyStart = doc.indexOf("\n\n") + 2;
  assert.deepEqual(state.languageDataAt("closeBrackets", bodyStart + 1), []);
  assert.deepEqual(state.languageDataAt("indentOnInput", bodyStart + 1), []);

  const brokenBodies = [
    "&=val&&=&&",
    "===&%ZZ=bad%2&",
    "flagonly",
    "k=v&unclosed=%",
  ];
  for (const body of brokenBodies) {
    const brokenDoc = `GET / HTTP/x\nContent-Type: application/x-www-form-urlencoded\n\n${body}`;
    const start = brokenDoc.indexOf("\n\n") + 2;

    const classSpans = highlightSpans(brokenDoc);
    assert.ok(classSpans.some((s) => s.to <= start && s.classes.includes("tok-invalid")));
    assert.deepEqual(
      classSpans.filter((s) => s.from >= start && s.classes.includes("tok-invalid")),
      [],
      `expected zero invalid spans in fuzzed form body: ${body}`,
    );

    for (const [name, highlighter, invalidCls] of [
      ["oneDark", oneDarkHighlightStyle, oneDarkInvalid],
      ["githubLight", githubLightHighlightStyle, githubLightInvalid],
    ]) {
      const spans = highlightSpans(brokenDoc, { highlighter });
      assert.deepEqual(
        spans.filter((s) => s.from >= start && s.classes.split(" ").includes(invalidCls)),
        [],
        `${name}: expected zero invalid spans in fuzzed form body: ${body}`,
      );
    }
  }
});

test("binary prefix guard skips body highlighting while preserving head highlighting", () => {
  const binaryPayloads = [
    ["gzip magic bytes", '\x1f\x8b\x08\x00\x00\x00\x00\x00{"id": 1}'],
    ["leading NUL byte", '\x00{"id": 1}'],
    ["NUL byte within first 256 chars", '{"id": 1}' + " ".repeat(200) + "\x00tail"],
    ["DEL control byte", '<html><body>\x7f</body></html>'],
    ["UTF-8 replacement char from lossy binary decode", "\uFFFDPNG\r\n\x1a\n<html></html>"],
    ["non-whitespace ASCII control byte", 'const x = 1;\x07;'],
  ];

  const contentTypes = [
    "application/json",
    "text/html",
    "application/xml",
    "application/javascript",
    "text/css",
    "application/x-www-form-urlencoded",
  ];

  for (const ct of contentTypes) {
    for (const [label, body] of binaryPayloads) {
      const head = `HTTP/1.1 200 OK\nContent-Type: ${ct}\nContent-Encoding: gzip\n\n`;
      const doc = head + body;
      const bodyStart = head.length;
      const spans = highlightSpans(doc);
      const headSpans = spans.filter((s) => s.to <= bodyStart);
      const bodySpans = spans.filter((s) => s.from >= bodyStart);

      assert.ok(headSpans.some((s) => s.text === "HTTP/1.1" && s.classes === "tok-keyword"), `head highlighted for ${ct} / ${label}`);
      assert.deepEqual(bodySpans, [], `body must stay unhighlighted for ${ct} / ${label}`);
    }
  }

  // Standard whitespace (\t, \n, \r\n) and valid UTF-8 text are NOT treated as binary
  const validUtf8 = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n\t\n{"greeting": "héllo 🚀"}';
  assert.equal(classFor(validUtf8, '"greeting"'), "tok-propertyName");
  assert.equal(classFor(validUtf8, '"héllo 🚀"'), "tok-string");

  // CRLF line endings normalized by EditorState also highlight normally
  const crlfState = EditorState.create({
    doc: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n\t\r\n{"ok": true}',
    extensions: httpHighlighting({ mode: "auto" }),
  });
  const crlfTree = ensureSyntaxTree(crlfState, crlfState.doc.length, 5000);
  const crlfSpans = [];
  highlightTree(crlfTree, classHighlighter, (from, to, classes) => {
    crlfSpans.push({ text: crlfState.doc.sliceString(from, to), classes });
  });
  assert.ok(crlfSpans.some((s) => s.text === '"ok"' && s.classes === "tok-propertyName"));
});

test("contradiction override switches to the actual format when body unmistakably contradicts Content-Type", () => {
  // Declared JSON with HTML error pages -> switches to HTML (including embedded <script>)
  for (const ct of ["application/json", "application/problem+json"]) {
    const doctypeHtml = `HTTP/1.1 502 Bad Gateway\nContent-Type: ${ct}\n\n  <!DOCTYPE html><html><body><h1>502</h1><script>const retry = 3;</script></body></html>`;
    assert.equal(classFor(doctypeHtml, "html", { fromIndex: doctypeHtml.indexOf("<html") }), "tok-typeName");
    assert.equal(classFor(doctypeHtml, "const", { fromIndex: doctypeHtml.indexOf("<script>") }), "tok-keyword");
    assert.equal(classFor(doctypeHtml, "3", { fromIndex: doctypeHtml.indexOf("<script>") }), "tok-number");

    const headingHtml = `HTTP/1.1 502 Bad Gateway\nContent-Type: ${ct}\n\n<h1>502 Bad Gateway</h1>`;
    assert.equal(classFor(headingHtml, "h1", { fromIndex: headingHtml.indexOf("<h1") }), "tok-typeName");

    // Declared JSON with XML -> switches to XML
    const xmlPi = `HTTP/1.1 403 Forbidden\nContent-Type: ${ct}\n\n<?xml version="1.0"?><error code="403"/>`;
    assert.equal(classFor(xmlPi, '<?xml version="1.0"?>'), "tok-meta");
    assert.equal(classFor(xmlPi, "error", { fromIndex: xmlPi.indexOf("<error") }), "tok-typeName");
    assert.equal(classFor(xmlPi, "code"), "tok-propertyName");

    const s3Xml = `HTTP/1.1 403 Forbidden\nContent-Type: ${ct}\n\n<Error><Code>AccessDenied</Code></Error>`;
    assert.equal(classFor(s3Xml, "Error", { fromIndex: s3Xml.indexOf("<Error") }), "tok-typeName");
    assert.equal(classFor(s3Xml, "Code", { fromIndex: s3Xml.indexOf("<Code") }), "tok-typeName");
  }

  // Declared HTML or XML with JSON object or array -> switches to JSON
  for (const ct of ["text/html", "application/xhtml+xml", "application/xml", "text/xml", "application/soap+xml"]) {
    const jsonObj = `HTTP/1.1 200 OK\nContent-Type: ${ct}\n\n  {"error": "unauthorized", "code": 401}`;
    assert.equal(classFor(jsonObj, '"error"'), "tok-propertyName", `JSON object under ${ct}`);
    assert.equal(classFor(jsonObj, "401"), "tok-number", `JSON number under ${ct}`);

    const jsonArr = `HTTP/1.1 200 OK\nContent-Type: ${ct}\n\n[{"id": 9, "active": true}]`;
    assert.equal(classFor(jsonArr, '"id"'), "tok-propertyName", `JSON array under ${ct}`);
    assert.equal(classFor(jsonArr, "true"), "tok-bool", `JSON bool under ${ct}`);
  }

  // Declared JS, CSS, or form-urlencoded with unmistakable HTML, XML, or JSON signature
  for (const ct of ["application/javascript", "text/css", "application/x-www-form-urlencoded"]) {
    const doctypeHtml = `HTTP/1.1 404 Not Found\nContent-Type: ${ct}\n\n<!DOCTYPE html><html><head><title>404</title></head></html>`;
    assert.equal(classFor(doctypeHtml, "html", { fromIndex: doctypeHtml.indexOf("<html") }), "tok-typeName", `DOCTYPE HTML under ${ct}`);
    assert.equal(classFor(doctypeHtml, "title", { fromIndex: doctypeHtml.indexOf("<title") }), "tok-typeName", `title tag under ${ct}`);

    const bareHtml = `HTTP/1.1 502 Bad Gateway\nContent-Type: ${ct}\n\n<html><body>502</body></html>`;
    assert.equal(classFor(bareHtml, "html", { fromIndex: bareHtml.indexOf("<html") }), "tok-typeName", `<html> under ${ct}`);

    const xmlDoc = `HTTP/1.1 500 Internal Server Error\nContent-Type: ${ct}\n\n<?xml version="1.0"?><error code="500"/>`;
    assert.equal(classFor(xmlDoc, '<?xml version="1.0"?>'), "tok-meta", `<?xml under ${ct}`);
    assert.equal(classFor(xmlDoc, "code", { fromIndex: xmlDoc.indexOf("\n\n") }), "tok-propertyName", `XML attr under ${ct}`);

    const jsonObj = `HTTP/1.1 403 Forbidden\nContent-Type: ${ct}\n\n{"error": "forbidden", "status": 403}`;
    assert.equal(classFor(jsonObj, '"error"'), "tok-propertyName", `JSON object under ${ct}`);
    assert.equal(classFor(jsonObj, "403", { fromIndex: jsonObj.indexOf("\n\n") }), "tok-number", `JSON number under ${ct}`);

    const jsonArr = `HTTP/1.1 200 OK\nContent-Type: ${ct}\n\n[{"id": 9, "ok": false}]`;
    assert.equal(classFor(jsonArr, '"id"'), "tok-propertyName", `JSON array under ${ct}`);
    assert.equal(classFor(jsonArr, "false"), "tok-bool", `JSON bool under ${ct}`);
  }
});

test("ambiguous, partial, or normal bodies keep their declared Content-Type", () => {
  // Partial JSON stays JSON
  const partialJson = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"a":';
  assert.equal(classFor(partialJson, '"a"'), "tok-propertyName");

  // Normal JS, array expression chains, and block statements stay JS
  const plainJs = "HTTP/1.1 200 OK\nContent-Type: application/javascript\n\nconst x = 1;";
  assert.equal(classFor(plainJs, "const"), "tok-keyword");

  const arrayChainJs = 'HTTP/1.1 200 OK\nContent-Type: application/javascript\n\n["a", "b"].forEach((s) => console.log(s));';
  assert.equal(classFor(arrayChainJs, "forEach"), "tok-propertyName");

  const blockJs = 'HTTP/1.1 200 OK\nContent-Type: application/javascript\n\n{"use strict"; const y = 2;}';
  assert.equal(classFor(blockJs, "const"), "tok-keyword");

  // Normal CSS stays CSS
  const css = "HTTP/1.1 200 OK\nContent-Type: text/css\n\nbody { color: red; }";
  assert.equal(classFor(css, "color"), "tok-propertyName");

  // Normal and fuzzed form-urlencoded stay form-urlencoded
  const form = "POST /submit HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\na=1&b=2";
  const formStart = form.indexOf("\n\n") + 2;
  assert.equal(classFor(form, "a", { fromIndex: formStart }), "tok-propertyName");
  assert.equal(classFor(form, "=", { fromIndex: formStart }), "tok-operator");
  assert.equal(classFor(form, "&", { fromIndex: formStart }), "tok-atom");

  const formWithHtmlVal = "POST /submit HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\npayload=<html>&q=1";
  const fuzzedStart = formWithHtmlVal.indexOf("\n\n") + 2;
  assert.equal(classFor(formWithHtmlVal, "payload", { fromIndex: fuzzedStart }), "tok-propertyName");
  assert.equal(classFor(formWithHtmlVal, "<html>", { fromIndex: fuzzedStart }), "tok-string");

  // Non-unmistakable leading '<' fragment in form-urlencoded keeps form
  const formLeadingAngle = "POST /submit HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\n<div=1&b=2";
  const angleStart = formLeadingAngle.indexOf("\n\n") + 2;
  assert.equal(classFor(formLeadingAngle, "<div", { fromIndex: angleStart }), "tok-propertyName");
  assert.equal(classFor(formLeadingAngle, "=", { fromIndex: angleStart }), "tok-operator");
});

test("prefix sniffing detects JSON, XML, and HTML when Content-Type is absent, generic, or unknown", () => {
  const genericHeads = [
    "HTTP/1.1 200 OK\n\n",
    "HTTP/1.1 200 OK\nContent-Type: text/plain; charset=utf-8\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/octet-stream\n\n",
    "HTTP/2 200\n:status: 200\ncontent-type: application/x-custom-payload\n\n",
  ];

  for (const head of genericHeads) {
    // JSON objects, arrays, BOM-prefixed JSON, and NDJSON
    const obj = `${head}  {"id": 42, "ok": true}`;
    assert.equal(classFor(obj, '"id"'), "tok-propertyName", `JSON object under ${head}`);
    assert.equal(classFor(obj, "42"), "tok-number", `JSON number under ${head}`);
    assert.equal(classFor(obj, "true"), "tok-bool", `JSON bool under ${head}`);

    const bomObj = `${head}\uFEFF{"bom": 1}`;
    assert.equal(classFor(bomObj, '"bom"'), "tok-propertyName", `BOM JSON under ${head}`);

    const arrObj = `${head}[{"k": "v"}]`;
    assert.equal(classFor(arrObj, '"k"'), "tok-propertyName", `JSON object array under ${head}`);

    const arrNum = `${head}[1, 2, 3]`;
    assert.equal(classFor(arrNum, "2", { fromIndex: head.length }), "tok-number", `JSON number array under ${head}`);

    const arrKw = `${head}[true, false, null]`;
    assert.equal(classFor(arrKw, "false", { fromIndex: head.length }), "tok-bool", `JSON keyword array under ${head}`);
    assert.equal(classFor(arrKw, "null", { fromIndex: head.length }), "tok-keyword", `JSON null array under ${head}`);

    const arrStr = `${head}["alpha", "beta"]`;
    assert.equal(classFor(arrStr, '"alpha"', { fromIndex: head.length }), "tok-string", `JSON string array under ${head}`);

    const nestedArr = `${head}[[1, 2], [3, 4]]`;
    assert.equal(classFor(nestedArr, "3", { fromIndex: head.length }), "tok-number", `nested JSON array under ${head}`);

    const emptyObj = `${head}{}`;
    assert.equal(classFor(emptyObj, "{", { fromIndex: head.length }), "tok-punctuation", `empty JSON object under ${head}`);

    const emptyArr = `${head}[]`;
    assert.equal(classFor(emptyArr, "[", { fromIndex: head.length }), "tok-punctuation", `empty JSON array under ${head}`);

    const ndjson = `${head}{"a": 1}\n{"b": 2}`;
    assert.equal(classFor(ndjson, '"b"', { fromIndex: head.length }), "tok-propertyName", `NDJSON under ${head}`);

    // XML signatures
    const xmlPi = `${head}<?xml version="1.0"?><root id="1"/>`;
    assert.equal(classFor(xmlPi, '<?xml version="1.0"?>'), "tok-meta", `XML PI under ${head}`);
    assert.equal(classFor(xmlPi, "id", { fromIndex: head.length }), "tok-propertyName", `XML attr under ${head}`);

    const svg = `${head}<svg xmlns="http://www.w3.org/2000/svg" width="16"></svg>`;
    assert.equal(classFor(svg, "svg", { fromIndex: svg.indexOf("<svg") }), "tok-typeName", `SVG under ${head}`);

    const soap = `${head}<soap:Envelope><soap:Body/></soap:Envelope>`;
    assert.equal(classFor(soap, "soap:Envelope", { fromIndex: head.length }), "tok-typeName", `SOAP under ${head}`);

    const rss = `${head}<rss version="2.0"><channel/></rss>`;
    assert.equal(classFor(rss, "rss", { fromIndex: head.length }), "tok-typeName", `RSS under ${head}`);

    const atom = `${head}<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    assert.equal(classFor(atom, "feed", { fromIndex: head.length }), "tok-typeName", `Atom under ${head}`);

    const genericXml = `${head}<Error><Code>AccessDenied</Code></Error>`;
    assert.equal(classFor(genericXml, "Error", { fromIndex: head.length }), "tok-typeName", `generic XML under ${head}`);

    // HTML signatures (including leading comment)
    const htmlDoc = `${head}<!DOCTYPE html><html><body><p>Hi</p></body></html>`;
    assert.equal(classFor(htmlDoc, "html", { fromIndex: htmlDoc.indexOf("<html") }), "tok-typeName", `DOCTYPE HTML under ${head}`);

    const htmlDiv = `${head}<div class="err">Oops</div>`;
    assert.equal(classFor(htmlDiv, "div", { fromIndex: head.length }), "tok-typeName", `HTML div under ${head}`);
    assert.equal(classFor(htmlDiv, "class", { fromIndex: head.length }), "tok-propertyName", `HTML attr under ${head}`);

    const commentedHtml = `${head}<!-- banner -->\n<!DOCTYPE html><html><body>Hi</body></html>`;
    assert.equal(classFor(commentedHtml, "html", { fromIndex: commentedHtml.indexOf("<html") }), "tok-typeName", `commented HTML under ${head}`);
  }
});

test("prefix sniffing leaves plain text, ambiguous prefixes, and JS/CSS/form bodies unhighlighted", () => {
  const genericHeads = [
    "HTTP/1.1 200 OK\n\n",
    "HTTP/1.1 200 OK\nContent-Type: text/plain\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/octet-stream\n\n",
    "HTTP/1.1 200 OK\nContent-Type: application/x-unknown\n\n",
  ];

  const nonSniffableBodies = [
    "Hello world",
    "[INFO] server started",
    "[2026-01-01] boot complete",
    "[1] item one",
    "{note}",
    "{} placeholder",
    "[] todo item",
    "[[wiki link]]",
    "<placeholder> enter your name",
    "<user@example.com>",
    "<p is less than 5>",
    "const x = 1; return x;",
    "body { color: red; }",
    "user=alice&role=admin",
  ];

  for (const head of genericHeads) {
    for (const body of nonSniffableBodies) {
      const doc = head + body;
      const bodyStart = head.length;
      const spans = highlightSpans(doc);
      const bodySpans = spans.filter((s) => s.from >= bodyStart);
      assert.deepEqual(bodySpans, [], `body must stay unhighlighted for ${JSON.stringify(body)} under ${head.trim()}`);
    }
  }
});

test("live edits re-evaluate binary guard, contradiction override, and prefix sniffing immediately", () => {
  const spansOf = (st) => {
    const tree = ensureSyntaxTree(st, st.doc.length, 5000);
    const out = [];
    if (!tree) return out;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      out.push({ from, to, text: st.doc.sliceString(from, to), classes });
    });
    return out;
  };

  // 1. Under text/plain, replacing plain text with JSON -> HTML -> XML -> plain text updates live
  const baseHead = "HTTP/1.1 200 OK\nContent-Type: text/plain\n\n";
  let state = EditorState.create({ doc: `${baseHead}hello world`, extensions: httpHighlighting({ mode: "auto" }) });
  const replaceBody = (st, nextBody) => {
    const bodyStart = st.doc.toString().indexOf("\n\n") + 2;
    return st.update({ changes: { from: bodyStart, to: st.doc.length, insert: nextBody } }).state;
  };

  assert.deepEqual(spansOf(state).filter((s) => s.from >= baseHead.length), []);

  state = replaceBody(state, '{"id": 7}');
  assert.ok(spansOf(state).some((s) => s.text === '"id"' && s.classes === "tok-propertyName"));

  state = replaceBody(state, "<h1>Error</h1>");
  assert.ok(spansOf(state).some((s) => s.text === "h1" && s.classes === "tok-typeName"));

  state = replaceBody(state, '<?xml version="1.0"?><ok/>');
  assert.ok(spansOf(state).some((s) => s.text === '<?xml version="1.0"?>' && s.classes === "tok-meta"));

  state = replaceBody(state, "[INFO] all clear");
  assert.deepEqual(spansOf(state).filter((s) => s.from >= baseHead.length), []);

  // 2. Under application/json, live contradiction and binary byte toggles update immediately
  const jsonHead = "HTTP/1.1 200 OK\nContent-Type: application/json\n\n";
  let jsonState = EditorState.create({ doc: `${jsonHead}{"ok": true}`, extensions: httpHighlighting({ mode: "auto" }) });
  assert.ok(spansOf(jsonState).some((s) => s.text === '"ok"' && s.classes === "tok-propertyName"));

  // Switch body to HTML error page -> overrides to HTML
  jsonState = replaceBody(jsonState, "<html><body>502</body></html>");
  assert.ok(spansOf(jsonState).some((s) => s.text === "html" && s.classes === "tok-typeName"));

  // Prepend NUL byte -> binary guard strips body highlighting while head stays highlighted
  jsonState = jsonState.update({ changes: { from: jsonHead.length, to: jsonHead.length, insert: "\x00" } }).state;
  const binSpans = spansOf(jsonState);
  assert.ok(binSpans.some((s) => s.text === "HTTP/1.1" && s.classes === "tok-keyword"));
  assert.deepEqual(binSpans.filter((s) => s.from >= jsonHead.length), []);

  // Remove NUL byte -> HTML override highlighting returns immediately
  jsonState = jsonState.update({ changes: { from: jsonHead.length, to: jsonHead.length + 1, insert: "" } }).state;
  assert.ok(spansOf(jsonState).some((s) => s.text === "html" && s.classes === "tok-typeName"));
});

test("JS bodies starting with a >256-char array literal keep JavaScript highlighting", () => {
  const longItem = "x".repeat(300);
  const jsDoc = `HTTP/1.1 200 OK\nContent-Type: application/javascript\n\n["${longItem}"].forEach((v) => console.log(v));`;
  assert.equal(classFor(jsDoc, "forEach"), "tok-propertyName");
  assert.equal(classFor(jsDoc, "console"), "tok-variableName");

  // Short closed JSON array under application/javascript still overrides cleanly to JSON
  const jsonArrAsJs = 'HTTP/1.1 200 OK\nContent-Type: application/javascript\n\n[{"id": 1}, {"id": 2}]';
  assert.equal(classFor(jsonArrAsJs, '"id"'), "tok-propertyName");
});
