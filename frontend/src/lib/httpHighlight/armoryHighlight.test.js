import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, foldable } from "@codemirror/language";
import { classHighlighter, highlightTree, tags as t } from "@lezer/highlight";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { SYNTAX_AUTO_LIMIT, httpHighlighting } from "../httpHighlight.js";
import {
  classFor as baseClassFor,
  createHttpState,
  githubLightHighlightStyle,
  highlightSpans as baseHighlightSpans,
} from "./testHelpers.js";

function overlaySpans(state) {
  const ranges = [];
  for (const dec of state.facet(EditorView.decorations)) {
    if (typeof dec === "function") continue;
    dec.between(0, state.doc.length, (from, to, value) => {
      ranges.push({
        from,
        to,
        text: state.doc.sliceString(from, to),
        className: value.spec.class ?? "",
      });
    });
  }
  return ranges;
}

function armoryState(doc, opts = {}) {
  return createHttpState(doc, { armory: true, ...opts });
}

function overlaysFor(doc, opts = {}) {
  return overlaySpans(armoryState(doc, opts));
}

function highlightSpans(doc, opts = {}) {
  return baseHighlightSpans(doc, { armory: true, ...opts });
}

function classFor(doc, needle, options = {}) {
  return baseClassFor(doc, needle, { armory: true, ...options });
}

test("@@fallback@@ payload markers highlight across start-line, headers, and JSON/HTML/form bodies", () => {
  const jsonDoc = [
    "POST /api/users/@@42@@ HTTP/1.1",
    "Host: app.test",
    "Authorization: Bearer @@tok@@",
    "Content-Type: application/json",
    "",
    '{"user": "@@admin@@", "id": @@1@@}',
  ].join("\n");

  const jsonMarks = overlaysFor(jsonDoc);
  assert.deepEqual(
    jsonMarks.map((m) => ({ text: m.text, className: m.className })),
    [
      { text: "@@42@@", className: "cm-armory-marker" },
      { text: "@@tok@@", className: "cm-armory-marker" },
      { text: "@@admin@@", className: "cm-armory-marker" },
      { text: "@@1@@", className: "cm-armory-marker" },
    ],
  );
  // Underlying HTTP head and JSON body syntax highlighting remain active
  assert.equal(classFor(jsonDoc, "POST"), "tok-keyword");
  assert.equal(classFor(jsonDoc, '"user"'), "tok-propertyName");

  const htmlDoc = [
    "POST /render HTTP/1.1",
    "Content-Type: text/html",
    "",
    '<div data-x="@@val@@">@@text@@</div>',
  ].join("\n");
  assert.deepEqual(
    overlaysFor(htmlDoc).map((m) => [m.text, m.className]),
    [
      ["@@val@@", "cm-armory-marker"],
      ["@@text@@", "cm-armory-marker"],
    ],
  );
  assert.equal(classFor(htmlDoc, "data-x"), "tok-propertyName");

  const formDoc = [
    "POST /login HTTP/1.1",
    "Content-Type: application/x-www-form-urlencoded",
    "",
    "user=@@alice@@&pass=@@secret@@",
  ].join("\n");
  assert.deepEqual(
    overlaysFor(formDoc).map((m) => [m.text, m.className]),
    [
      ["@@alice@@", "cm-armory-marker"],
      ["@@secret@@", "cm-armory-marker"],
    ],
  );
  assert.equal(classFor(formDoc, "user", { fromIndex: formDoc.indexOf("\n\n") + 2 }), "tok-propertyName");
});

test("valid chained .fn() calls after @@...@@ highlight with distinct class while unknown calls do not", () => {
  const allTen = [
    "upper",
    "lower",
    "reverse",
    "trim",
    "base64",
    "hex",
    "sha256",
    "urlencode",
    "pathescape",
    "raw",
  ];
  for (const fn of allTen) {
    const doc = `GET /@@x@@.${fn}() HTTP/1.1\n\n`;
    const marks = overlaysFor(doc);
    assert.deepEqual(
      marks.map((m) => [m.text, m.className]),
      [
        ["@@x@@", "cm-armory-marker"],
        [`.${fn}()`, "cm-armory-chain"],
      ],
      `chained .${fn}() must be highlighted`,
    );
  }

  // Multiple chained calls
  const multi = "GET /@@admin@@.trim().lower().base64() HTTP/1.1\n\n";
  assert.deepEqual(
    overlaysFor(multi).map((m) => [m.text, m.className]),
    [
      ["@@admin@@", "cm-armory-marker"],
      [".trim()", "cm-armory-chain"],
      [".lower()", "cm-armory-chain"],
      [".base64()", "cm-armory-chain"],
    ],
  );

  // Unknown or non-chainable calls stop chaining
  const invalid = "GET /@@a@@.bogus() @@b@@.trim().bogus().lower() @@c@@.replace() @@d@@.uuid() @@e@@.upper(1) HTTP/1.1\n\n";
  assert.deepEqual(
    overlaysFor(invalid).map((m) => [m.text, m.className]),
    [
      ["@@a@@", "cm-armory-marker"],
      ["@@b@@", "cm-armory-marker"],
      [".trim()", "cm-armory-chain"],
      ["@@c@@", "cm-armory-marker"],
      ["@@d@@", "cm-armory-marker"],
      ["@@e@@", "cm-armory-marker"],
    ],
  );
});

test("@@ markers respect \\@ and \\\\ escapes and unclosed @@ does not swallow the rest of the doc", () => {
  // Escaped \@ prevents opening a marker
  const escapedOpen = "GET /\\@\\@notamarker\\@\\@ HTTP/1.1\n\n";
  assert.deepEqual(overlaysFor(escapedOpen), []);

  // Escaped \\ before @@ allows @@ to open normally
  const escapedSlashOpen = "GET /\\\\@@yes@@ HTTP/1.1\n\n";
  assert.deepEqual(
    overlaysFor(escapedSlashOpen).map((m) => [m.text, m.className]),
    [["@@yes@@", "cm-armory-marker"]],
  );

  // Escaped \@ inside a marker does not close it; escaped \\ before closing @@ closes it
  const escapedInside = "GET /@@foo\\@@bar@@ @@baz\\\\@@ HTTP/1.1\n\n";
  assert.deepEqual(
    overlaysFor(escapedInside).map((m) => [m.text, m.className]),
    [
      ["@@foo\\@@bar@@", "cm-armory-marker"],
      ["@@baz\\\\@@", "cm-armory-marker"],
    ],
  );

  // Multiline marker matches Marasi's armory/templates.go semantics
  const multiline = "POST / HTTP/1.1\n\n@@line1\nline2@@.base64()";
  assert.deepEqual(
    overlaysFor(multiline).map((m) => [m.text, m.className]),
    [
      ["@@line1\nline2@@", "cm-armory-marker"],
      [".base64()", "cm-armory-chain"],
    ],
  );

  // Unclosed @@ produces no runaway highlight
  const unclosed = "POST / HTTP/1.1\nHost: example.test\n\n@@unclosed trailing text";
  assert.deepEqual(overlaysFor(unclosed), []);
});

test("live edits update Armory marker decorations immediately", () => {
  let state = armoryState("GET /user HTTP/1.1\n\n");
  assert.deepEqual(overlaySpans(state), []);

  // Type @@id@@.upper()
  const pos = "GET /".length;
  state = state.update({ changes: { from: pos, to: pos + 4, insert: "@@id@@.upper()" } }).state;
  assert.deepEqual(
    overlaySpans(state).map((m) => [m.text, m.className]),
    [
      ["@@id@@", "cm-armory-marker"],
      [".upper()", "cm-armory-chain"],
    ],
  );

  // Break the closing @@ -> decoration disappears immediately
  const closePos = state.doc.toString().indexOf("@@.upper()");
  state = state.update({ changes: { from: closePos, to: closePos + 1, insert: "" } }).state;
  assert.deepEqual(overlaySpans(state), []);
});

test("Armory overlays respect SyntaxMode disabled/undefined and never run when armory is false", () => {
  const doc = "GET /@@id@@.base64() HTTP/1.1\nHost: a.test\n\n";
  assert.deepEqual(overlaysFor(doc, { mode: "disabled", armory: true }), []);
  assert.deepEqual(overlaysFor(doc, { mode: undefined, armory: true }), []);
  assert.deepEqual(highlightSpans(doc, { mode: "disabled", armory: true }), []);
  assert.deepEqual(highlightSpans(doc, { mode: undefined, armory: true }), []);

  // Scoping guarantee: ordinary HTTP editors (armory omitted or false) never highlight Armory syntax
  assert.deepEqual(overlaysFor(doc, { mode: "enabled", armory: false }), []);
  const defaultState = EditorState.create({ doc, extensions: httpHighlighting({ mode: "enabled" }) });
  assert.deepEqual(overlaySpans(defaultState), []);
});

test("Go text/template {{...}} actions highlight across head and quoted/unquoted JSON, HTML, and form bodies", () => {
  const jsonDoc = [
    'POST /items/{{.Payload 0 "1"}} HTTP/1.1',
    'X-Req-Id: {{uuid}}',
    'X-Auth: {{.Payload 1 "guest" | base64}}',
    "Content-Type: application/json",
    "",
    '{"quoted": "{{replace "a" "b" (.Payload 2 "abc")}}", "unquoted": {{.Payload 3 "42"}}}',
  ].join("\n");

  assert.deepEqual(
    overlaysFor(jsonDoc).map((m) => [m.text, m.className]),
    [
      ['{{.Payload 0 "1"}}', "cm-armory-template"],
      ["{{uuid}}", "cm-armory-template"],
      ['{{.Payload 1 "guest" | base64}}', "cm-armory-template"],
      ['{{replace "a" "b" (.Payload 2 "abc")}}', "cm-armory-template"],
      ['{{.Payload 3 "42"}}', "cm-armory-template"],
    ],
  );
  // Underlying JSON keys still highlight and produce zero invalid spans
  assert.equal(classFor(jsonDoc, '"quoted"'), "tok-propertyName");
  assert.equal(classFor(jsonDoc, '"unquoted"'), "tok-propertyName");
  const jsonBodyStart = jsonDoc.indexOf("\n\n") + 2;
  assert.deepEqual(
    highlightSpans(jsonDoc).filter((s) => s.from >= jsonBodyStart && s.classes.includes("tok-invalid")),
    [],
  );

  const htmlDoc = [
    "POST /tpl HTTP/1.1",
    "Content-Type: text/html",
    "",
    '<p data-id="{{.Payload 0 "1"}}">{{.Payload 1 "hi" | upper}}</p>',
  ].join("\n");
  assert.deepEqual(
    overlaysFor(htmlDoc).map((m) => [m.text, m.className]),
    [
      ['{{.Payload 0 "1"}}', "cm-armory-template"],
      ['{{.Payload 1 "hi" | upper}}', "cm-armory-template"],
    ],
  );

  const formDoc = [
    "POST /form HTTP/1.1",
    "Content-Type: application/x-www-form-urlencoded",
    "",
    'a={{.Payload 0 "v1" | urlencode}}&b={{uuid}}',
  ].join("\n");
  assert.deepEqual(
    overlaysFor(formDoc).map((m) => [m.text, m.className]),
    [
      ['{{.Payload 0 "v1" | urlencode}}', "cm-armory-template"],
      ["{{uuid}}", "cm-armory-template"],
    ],
  );
});

test("Go template actions handle trim markers, string escapes, backtick raw strings, comments, and unclosed {{", () => {
  const doc = [
    "POST /test HTTP/1.1",
    "",
    '{{- .Payload 0 "a\\"b}}c\\\\" -}}',
    "{{`{{`}}",
    "{{`raw }} backtick`}}",
    "{{/* comment with }} inside */}}",
    "{{- /* trimmed comment */ -}}",
  ].join("\n");

  assert.deepEqual(
    overlaysFor(doc).map((m) => [m.text, m.className]),
    [
      ['{{- .Payload 0 "a\\"b}}c\\\\" -}}', "cm-armory-template"],
      ["{{`{{`}}", "cm-armory-template"],
      ["{{`raw }} backtick`}}", "cm-armory-template"],
      ["{{/* comment with }} inside */}}", "cm-armory-template"],
      ["{{- /* trimmed comment */ -}}", "cm-armory-template"],
    ],
  );

  // Unclosed {{ does not swallow the rest of the doc, and unclosed @@ does not swallow a later {{uuid}}
  assert.deepEqual(overlaysFor("GET / HTTP/1.1\n\n{{unclosed action"), []);
  assert.deepEqual(
    overlaysFor("GET / HTTP/1.1\n\n@@unclosed {{uuid}}").map((m) => [m.text, m.className]),
    [["{{uuid}}", "cm-armory-template"]],
  );

  // Non-Armory HTML with Vue/Handlebars {{...}} is never treated as Armory template syntax
  const vueHtml = "HTTP/1.1 200 OK\nContent-Type: text/html\n\n<div>{{ user.name }}</div>";
  assert.deepEqual(overlaysFor(vueHtml, { mode: "enabled", armory: false }), []);
});

test("framed grpc, grpc-web, and connect templates highlight separators and Protobuf text form bodies", () => {
  const body = [
    "--- message ---",
    "# first payload",
    "1:VARINT 42",
    '2:LEN {"@@hello@@.raw()"}',
    "3: `0a1b`",
    "--- message compressed ---",
    "1:VARINT true",
  ].join("\n");

  const cases = [
    { framing: "grpc", ct: "application/grpc" },
    { framing: "grpc", ct: "application/grpc+proto" },
    { framing: "grpc-web", ct: "application/grpc-web" },
    { framing: "grpc-web", ct: "application/grpc-web+proto" },
    { framing: "connect", ct: "application/connect+proto" },
    { framing: "grpc", ct: "" },
  ];

  for (const { framing, ct } of cases) {
    const head = ct
      ? `POST /svc.Echo/Say HTTP/2\n:authority: api.test\ncontent-type: ${ct}\n\n`
      : "POST /svc.Echo/Say HTTP/2\n:authority: api.test\n\n";
    const doc = head + body;
    const bodyStart = head.length;
    const opts = { framing };

    assert.equal(classFor(doc, "--- message ---", opts), "tok-heading", `sep for ${framing}/${ct}`);
    assert.equal(classFor(doc, "--- message compressed ---", opts), "tok-heading", `comp sep for ${framing}/${ct}`);
    assert.equal(classFor(doc, "# first payload", opts), "tok-comment", `comment for ${framing}/${ct}`);
    assert.equal(classFor(doc, "1:", { ...opts, fromIndex: bodyStart }), "tok-variableName tok-definition");
    assert.equal(classFor(doc, "VARINT", opts), "tok-keyword");
    assert.equal(classFor(doc, "42", { ...opts, fromIndex: bodyStart }), "tok-number");
    assert.equal(classFor(doc, "2:", { ...opts, fromIndex: bodyStart }), "tok-variableName tok-definition");
    assert.equal(classFor(doc, "LEN", opts), "tok-keyword");
    assert.equal(classFor(doc, '"@@hello@@.raw()"', opts), "tok-string");
    assert.equal(classFor(doc, "`0a1b`", opts), "tok-string2");
    assert.equal(classFor(doc, "true", { ...opts, fromIndex: bodyStart }), "tok-atom");

    // Armory overlay markers coexist inside framed protobuf messages
    assert.deepEqual(
      overlaysFor(doc, opts).map((m) => [m.text, m.className]),
      [
        ["@@hello@@", "cm-armory-marker"],
        [".raw()", "cm-armory-chain"],
      ],
    );

    // Styled distinctly in both oneDark and githubLight
    for (const [themeName, highlighter] of [
      ["oneDark", oneDarkHighlightStyle],
      ["githubLight", githubLightHighlightStyle],
    ]) {
      const sepCls = classFor(doc, "--- message ---", { ...opts, highlighter });
      const wireCls = classFor(doc, "VARINT", { ...opts, highlighter });
      const strCls = classFor(doc, '"@@hello@@.raw()"', { ...opts, highlighter });
      const numCls = classFor(doc, "42", { ...opts, fromIndex: bodyStart, highlighter });
      assert.ok(sepCls && wireCls && strCls && numCls, `${themeName}: framed protobuf tokens must be styled`);
      assert.notEqual(sepCls, wireCls, `${themeName}: separator should be visually distinct from wire type`);
    }
  }

  // CRLF line endings work for separators too
  const crlfDoc = "POST /svc/M HTTP/2\r\ncontent-type: application/grpc\r\n\r\n--- message ---\r\n1:VARINT 7\r\n";
  assert.equal(classFor(crlfDoc, "--- message ---", { framing: "grpc" }), "tok-heading");
  assert.equal(classFor(crlfDoc, "VARINT", { framing: "grpc" }), "tok-keyword");
});

test("framed templates with JSON content types highlight separators and JSON message bodies", () => {
  const body = [
    "--- message ---",
    '{"name": "@@alice@@", "count": 3}',
    "--- message compressed ---",
    '{"ok": true, "extra": {{uuid}}}',
  ].join("\n");

  const cases = [
    { framing: "grpc", ct: "application/grpc+json" },
    { framing: "grpc-web", ct: "application/grpc-web+json; charset=utf-8" },
    { framing: "connect", ct: "application/connect+json" },
    { framing: "connect", ct: "application/json" },
  ];

  for (const { framing, ct } of cases) {
    const doc = `POST /svc/M HTTP/2\ncontent-type: ${ct}\n\n${body}`;
    const opts = { framing };

    assert.equal(classFor(doc, "--- message ---", opts), "tok-heading");
    assert.equal(classFor(doc, "--- message compressed ---", opts), "tok-heading");
    assert.equal(classFor(doc, '"name"', opts), "tok-propertyName");
    assert.equal(classFor(doc, "3", { ...opts, fromIndex: doc.indexOf("count") }), "tok-number");
    assert.equal(classFor(doc, '"ok"', opts), "tok-propertyName");
    assert.equal(classFor(doc, "true", opts), "tok-bool");

    assert.deepEqual(
      overlaysFor(doc, opts).map((m) => [m.text, m.className]),
      [
        ["@@alice@@", "cm-armory-marker"],
        ["{{uuid}}", "cm-armory-template"],
      ],
    );

    for (const highlighter of [oneDarkHighlightStyle, githubLightHighlightStyle]) {
      assert.ok(classFor(doc, "--- message ---", { ...opts, highlighter }));
      assert.ok(classFor(doc, '"name"', { ...opts, highlighter }));
    }
  }
});

test("Connect unary separator-less bodies highlight as Protobuf text form or JSON by Content-Type", () => {
  const protoDoc = "POST /svc.Echo/Say HTTP/1.1\nContent-Type: application/proto\n\n1:VARINT 9\n2:LEN {\"hi\"}";
  assert.equal(classFor(protoDoc, "1:", { framing: "connect", fromIndex: protoDoc.indexOf("\n\n") + 2 }), "tok-variableName tok-definition");
  assert.equal(classFor(protoDoc, "VARINT", { framing: "connect" }), "tok-keyword");
  assert.equal(classFor(protoDoc, '"hi"', { framing: "connect" }), "tok-string");

  const jsonDoc = 'POST /svc.Echo/Say HTTP/1.1\nContent-Type: application/json\n\n{"msg": "hi", "n": 5}';
  assert.equal(classFor(jsonDoc, '"msg"', { framing: "connect" }), "tok-propertyName");
  assert.equal(classFor(jsonDoc, '"hi"', { framing: "connect" }), "tok-string");
  assert.equal(classFor(jsonDoc, "5", { framing: "connect", fromIndex: jsonDoc.indexOf("\n\n") + 2 }), "tok-number");
});

test("framed bodies support message and JSON folding without closeBrackets, emit zero invalid spans, respect SYNTAX_AUTO_LIMIT, and stay off outside Armory", () => {
  const doc = [
    "POST /svc/M HTTP/2",
    "content-type: application/grpc+json",
    "",
    "--- message ---",
    '{\n  "broken": \n}',
  ].join("\n");

  const state = armoryState(doc, { framing: "grpc" });
  ensureSyntaxTree(state, doc.length, 5000);
  const sepLine = state.doc.line(4);
  assert.deepEqual(foldable(state, sepLine.from, sepLine.to), { from: sepLine.to, to: doc.length });
  const jsonLine = state.doc.line(5);
  assert.ok(foldable(state, jsonLine.from, jsonLine.to), "JSON object inside framed message folds");
  const bodyStart = doc.indexOf("\n\n") + 2;
  assert.deepEqual(state.languageDataAt("closeBrackets", doc.indexOf('"broken"')), []);
  assert.deepEqual(state.languageDataAt("indentOnInput", doc.indexOf('"broken"')), []);
  assert.deepEqual(
    highlightSpans(doc, { framing: "grpc" }).filter((s) => s.from >= bodyStart && s.classes.includes("tok-invalid")),
    [],
  );

  const protoDoc = [
    "POST /svc/M HTTP/2",
    "content-type: application/grpc",
    "",
    "--- message ---",
    "1:VARINT 1",
    '2:LEN {"first"}',
    "--- message compressed ---",
    "1:VARINT 2",
  ].join("\n");
  const protoState = armoryState(protoDoc, { framing: "grpc" });
  ensureSyntaxTree(protoState, protoDoc.length, 5000);
  const firstMsg = protoState.doc.line(4);
  const secondMsg = protoState.doc.line(7);
  assert.deepEqual(
    foldable(protoState, firstMsg.from, firstMsg.to),
    { from: firstMsg.to, to: protoState.doc.line(6).to },
    "first framed message folds without swallowing the next separator line",
  );
  assert.deepEqual(
    foldable(protoState, secondMsg.from, secondMsg.to),
    { from: secondMsg.to, to: protoState.doc.line(8).to },
    "compressed framed message folds cleanly",
  );
  assert.deepEqual(protoState.languageDataAt("closeBrackets", protoDoc.indexOf('"first"')), []);
  assert.deepEqual(protoState.languageDataAt("indentOnInput", protoDoc.indexOf('"first"')), []);

  // SYNTAX_AUTO_LIMIT: under auto, head & head Armory overlays stay active while body (>= 75,000) skips both body parser and Armory overlays
  const head = "POST /svc/M HTTP/2\n:authority: @@host@@\ncontent-type: application/grpc\n\n";
  const largeBody = `--- message ---\n1:LEN {"@@bodyMarker@@ {{uuid}} ${"a".repeat(SYNTAX_AUTO_LIMIT)}"}\n`;
  assert.ok(largeBody.length >= SYNTAX_AUTO_LIMIT);
  const largeDoc = head + largeBody;

  assert.equal(classFor(largeDoc, "POST", { mode: "auto", framing: "grpc" }), "tok-keyword");
  assert.equal(classFor(largeDoc, "--- message ---", { mode: "auto", framing: "grpc" }), null);
  assert.deepEqual(
    overlaysFor(largeDoc, { mode: "auto", framing: "grpc" }).map((m) => [m.text, m.className]),
    [["@@host@@", "cm-armory-marker"]],
  );

  // Under enabled, large framed body AND its Armory overlays ARE highlighted
  assert.equal(classFor(largeDoc, "--- message ---", { mode: "enabled", framing: "grpc" }), "tok-heading");
  assert.equal(classFor(largeDoc, "LEN", { mode: "enabled", framing: "grpc" }), "tok-keyword");
  assert.deepEqual(
    overlaysFor(largeDoc, { mode: "enabled", framing: "grpc" }).map((m) => [m.text, m.className]),
    [
      ["@@host@@", "cm-armory-marker"],
      ["@@bodyMarker@@", "cm-armory-marker"],
      ["{{uuid}}", "cm-armory-template"],
    ],
  );

  // Scoping guarantee: non-Armory HTTP editor NEVER highlights --- message --- as a framed separator
  const nonArmoryDoc = "POST /svc/M HTTP/2\ncontent-type: application/grpc\n\n--- message ---\n1:VARINT 1\n";
  assert.equal(classFor(nonArmoryDoc, "--- message ---", { mode: "enabled", armory: false }), null);
  assert.equal(classFor(nonArmoryDoc, "--- message ---", { mode: "enabled", armory: false, framing: "grpc" }), null);
  assert.equal(classFor(nonArmoryDoc, "VARINT", { mode: "enabled", armory: false, framing: "grpc" }), null);

  // Live reconfiguration switching framing on and off
  let reconf = armoryState(nonArmoryDoc, { mode: "auto", armory: true, framing: "" });
  const spansOf = (st) => {
    const tree = ensureSyntaxTree(st, st.doc.length, 5000);
    const out = [];
    if (!tree) return out;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      out.push({ text: st.doc.sliceString(from, to), classes });
    });
    return out;
  };
  assert.equal(spansOf(reconf).some((s) => s.text === "--- message ---" && s.classes === "tok-heading"), false);
  reconf = reconf.update({ effects: StateEffect.reconfigure.of(httpHighlighting({ mode: "auto", armory: true, framing: "grpc" })) }).state;
  assert.equal(spansOf(reconf).some((s) => s.text === "--- message ---" && s.classes === "tok-heading"), true);
  assert.equal(spansOf(reconf).some((s) => s.text === "VARINT" && s.classes === "tok-keyword"), true);
});

test("Armory actions and markers containing spaces in the request target keep HTTP version valid", () => {
  const templateTarget = 'POST /items/{{.Payload 0 "1"}} HTTP/1.1\nHost: app.test\n\n';
  assert.equal(classFor(templateTarget, "POST"), "tok-keyword");
  assert.equal(classFor(templateTarget, '/items/{{.Payload 0 "1"}}'), "tok-string2");
  assert.equal(classFor(templateTarget, "HTTP/1.1"), "tok-keyword");
  assert.deepEqual(
    highlightSpans(templateTarget).filter((s) => s.classes.includes("tok-invalid")),
    [],
  );

  const markerTarget = "GET /search?q=@@hello world@@.urlencode() HTTP/2\n:authority: app.test\n\n";
  assert.equal(classFor(markerTarget, "GET"), "tok-keyword");
  assert.equal(classFor(markerTarget, "/search?q=@@hello world@@.urlencode()"), "tok-string2");
  assert.equal(classFor(markerTarget, "HTTP/2"), "tok-keyword");
  assert.deepEqual(
    highlightSpans(markerTarget).filter((s) => s.classes.includes("tok-invalid")),
    [],
  );

  // Non-Armory mode still flags unescaped spaces in the request target as invalid
  assert.equal(classFor(templateTarget, "HTTP/1.1", { armory: false }), "tok-invalid");
});


