import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tfkrTheme } from "../../tfkr-theme.js";

// Marasi is square-edged: no rounded corners. The only rounded classes
// allowed are rounded-none and rounded-0, plus rounded-full on a dot (see
// isDot) or on an entry in CIRCLES. Skeleton's rounded-token and
// rounded-container-token take the theme's radius, which the theme pins to
// 0px, so they are no-ops: leave them out.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const APP_CSS = join(SRC, "app.css");
// Generated Wails bindings.
const SKIP = new Set(["bindings"]);
const EXTENSIONS = [".svelte", ".js", ".css"];

// rounded-full that isn't a dot but is still meant to be a circle. `text` is
// a piece of the offending line; a stale entry fails the test too.
const CIRCLES = [
  {
    file: "routes/+layout.svelte",
    text: "h-full w-full animate-ping rounded-full",
    reason: "the update dot's ping halo, sized to the h-3 w-3 dot under it",
  },
];

// A CSS border-radius other than 0, meant to be round.
const CSS_RADII = [
  {
    file: "lib/components/NotesModal.svelte",
    text: "border-radius: 50%",
    reason: "the loading spinner is a ring",
  },
];

const SQUARE = new Set(["rounded-none", "rounded-0"]);
// A rounded class, with any variant prefix (dark:, hover:) left outside the match.
const ROUNDED = /(?<![\w$.{-])rounded(?:-[\w.[\]/%-]+)?(?![\w-])/g;
const RADIUS = /(?:border-radius|borderRadius)\s*:\s*["']?([^;"',}\n]+)/g;
const ZERO = /^0(?:px|rem|%)?(?:\s*!important)?$/;
const DOT_MAX = 4; // h-4, 1rem

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sourceFiles(path);
    return EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".test.js") ? [path] : [];
  });
}

const isComment = (line) => /^\s*(?:\*|\/\/|\/\*|<!--)/.test(line);

// The class string around `index`: from the nearest " or ` before it to the
// same quote after it. Svelte expressions inside a class use ' quotes, so a
// multi-line class attribute comes back whole.
function enclosingString(text, index) {
  const start = Math.max(text.lastIndexOf('"', index), text.lastIndexOf("`", index));
  if (start < 0) return text.slice(index, index + 200);
  const end = text.indexOf(text[start], index);
  return text.slice(start, end < 0 ? undefined : end);
}

// rounded-full on an element with the same fixed width and height, at most
// 1rem: a status dot, a colour swatch or a radio knob, which is a circle by
// design. Anything bigger is a box with its corners rounded.
export function isDot(classes) {
  const size = classes.match(/(?<![\w-])size-(\d+(?:\.5)?)(?![\w-])/);
  if (size) return Number(size[1]) <= DOT_MAX;
  const h = classes.match(/(?<![\w:-])h-(\d+(?:\.5)?)(?![\w-])/);
  const w = classes.match(/(?<![\w:-])w-(\d+(?:\.5)?)(?![\w-])/);
  return Boolean(h && w && h[1] === w[1] && Number(h[1]) <= DOT_MAX);
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function scan() {
  const offenders = [];
  const used = new Set();
  const allowed = (list, file, line) => {
    const entry = list.find((e) => e.file === file && line.includes(e.text));
    if (entry) used.add(entry);
    return Boolean(entry);
  };
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path);
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    for (const match of text.matchAll(ROUNDED)) {
      const n = lineAt(text, match.index);
      const line = lines[n - 1];
      const after = text.slice(match.index + match[0].length);
      // A prop or key named rounded (export let rounded =, rounded: x), not a class.
      if (match[0] === "rounded" && !/^[\s"'`]/.test(after)) continue;
      if (/^\s*[=:]/.test(after)) continue;
      if (isComment(line) || SQUARE.has(match[0])) continue;
      if (match[0] === "rounded-full") {
        if (isDot(enclosingString(text, match.index))) continue;
        if (allowed(CIRCLES, file, line)) continue;
      }
      offenders.push(`${file}:${n}: ${match[0]} in ${line.trim()}`);
    }
    for (const match of text.matchAll(RADIUS)) {
      const n = lineAt(text, match.index);
      const line = lines[n - 1];
      if (isComment(line) || ZERO.test(match[1].trim()) || allowed(CSS_RADII, file, line)) continue;
      offenders.push(`${file}:${n}: ${line.trim()}`);
    }
  }
  const stale = [...CIRCLES, ...CSS_RADII].filter((e) => !used.has(e)).map((e) => `${e.file}: ${e.text}`);
  return { offenders, stale };
}

test("no rounded corners in the frontend: only rounded-none, rounded-0 and rounded-full dots", () => {
  const { offenders } = scan();
  assert.deepEqual(
    offenders,
    [],
    "Marasi is square-edged. Remove the rounded class or radius (rounded-none if Skeleton rounds it); " +
      "rounded-full is only for a dot at most h-4 w-4, or an entry in CIRCLES with a reason:\n" +
      offenders.join("\n"),
  );
});

test("every square-edges allowlist entry still matches a line", () => {
  assert.deepEqual(scan().stale, [], "Remove these stale allowlist entries from squareEdges.test.js");
});

test("the theme keeps Skeleton's radius tokens at 0px", () => {
  assert.equal(tfkrTheme.properties["--theme-rounded-base"], "0px");
  assert.equal(tfkrTheme.properties["--theme-rounded-container"], "0px");
});

test("app.css squares Skeleton's icon button and icon badge, which ignore the radius tokens", () => {
  const css = readFileSync(APP_CSS, "utf8");
  const rule = css.match(/\.btn-icon,\s*\.badge-icon\s*\{([^}]*)\}/);
  assert.ok(rule, "app.css needs a `.btn-icon, .badge-icon { border-radius: 0; }` rule");
  assert.match(rule[1], /border-radius:\s*0\s*;/);
});

test("isDot accepts small equal sizes only", () => {
  assert.ok(isDot("h-2 w-2 rounded-full"));
  assert.ok(isDot("flex h-4 w-4 rounded-full"));
  assert.ok(isDot("w-1.5 h-1.5 rounded-full"));
  assert.ok(!isDot("h-5 w-5 rounded-full"));
  assert.ok(!isDot("h-2 w-3 rounded-full"));
  assert.ok(!isDot("rounded-full p-2"));
});
