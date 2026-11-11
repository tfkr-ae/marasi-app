import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { neutralVariant, primaryVariant, tertiaryVariant } from "./launchpad/format.js";

// Buttons follow the theme variant for light and dark mode, have no borders,
// and hover the same way (app.css). An action button (one with Skeleton's btn
// or btn-icon class) takes its variant from primaryVariant($modeCurrent), or
// tertiaryVariant / neutralVariant beside it in launchpad/format.js, never a
// one-off Skeleton variant such as variant-soft-error or variant-ghost-surface,
// and no border or ring class. Row, menu, tab and swatch buttons without btn
// are not checked.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["bindings"]);
const EXTENSIONS = [".svelte", ".js"];

// The variant classes the theme helpers hand out, in either mode.
const THEME_VARIANTS = new Set(
  [true, false]
    .flatMap((light) => [primaryVariant(light), tertiaryVariant(light), neutralVariant(light)])
    .join(" ")
    .split(/\s+/)
    .filter((c) => c.startsWith("variant-")),
);

// Existing buttons left as they are until the owner decides. `count` is the
// exact number of offending `token`s in `file`: a new one fails, and fixing
// one means lowering the count (or removing the entry).
const GRANDFATHERED = [
  // The neutral soft style of small toolbar buttons (expand/collapse all,
  // cancel an inline edit) and of an unselected tab or toggle.
  { file: "lib/dock/Dock.svelte", token: "variant-soft", count: 2, reason: "dock toolbar icon buttons" },
  { file: "lib/launchpad/LaunchpadTree.svelte", token: "variant-soft", count: 2, reason: "expand/collapse all icon buttons" },
  { file: "lib/launchpad/LaunchpadWorkspace.svelte", token: "variant-soft", count: 3, reason: "cancel rename, unselected Compare toggle, tree toggle" },
  { file: "lib/launchpad/LaunchpadCompare.svelte", token: "variant-soft", count: 2, reason: "swap button and unselected compare tab" },
  { file: "lib/ledger/LedgerSitemap.svelte", token: "variant-soft", count: 1, reason: "collapse-all icon button" },
  { file: "lib/ledger/LedgerTypesMenu.svelte", token: "variant-soft", count: 1, reason: "unselected type toggle" },
  { file: "lib/ledger/SavedQueriesMenu.svelte", token: "variant-soft", count: 2, reason: "cancel save and the menu's own row button" },
  { file: "routes/checkpoint/+page.svelte", token: "variant-soft", count: 1, reason: "unselected Held/Rules tab" },
  { file: "routes/settings/+page.svelte", token: "variant-soft", count: 3, reason: "secondary settings rows (add, browse)" },
  // Segmented filters: filled when picked, soft when not.
  { file: "lib/components/Keybindings/KeybindingsModal.svelte", token: "variant-soft-primary", count: 1, reason: "segmented filter, unselected state" },
  { file: "routes/settings/+page.svelte", token: "variant-soft-primary", count: 2, reason: "segmented choice, unselected state" },
  // State toggles whose colour says the state.
  { file: "lib/components/WebSocketCheckpoint.svelte", token: "variant-soft-success", count: 2, reason: "Intercept On/Off toggle: green when on" },
  { file: "lib/components/WebSocketCheckpoint.svelte", token: "variant-soft-primary", count: 1, reason: "Intercept On/Off toggle: off state" },
  // Not imported anywhere.
  { file: "lib/components/datatables/Pagination.svelte", token: "variant-ghost-surface", count: 2, reason: "unused datatables scaffold" },
  { file: "lib/components/datatables/Pagination.svelte", token: "variant-soft-primary", count: 2, reason: "unused datatables scaffold" },
];

const BTN = /(?<![\w-])btn(?:-icon)?(?:-(?:sm|lg|xl))?(?![\w-])/;
const VARIANT = /(?<![\w-])variant-[a-z]+(?:-[a-z]+)?(?![\w-])/g;
const BORDER =
  /(?<![\w:-])!?(?:border(?:-[trblxy])?(?:-[1-9]\d*)?|border-(?!none\b|transparent\b)[a-z]{2,}(?:-\d+)?(?:\/\d+)?|ring(?:-[1-9]\d*)?|ring-(?!offset\b|inset\b)[a-z]{2,}(?:-\d+)?(?:\/\d+)?)(?![\w-])/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sourceFiles(path);
    return EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".test.js") ? [path] : [];
  });
}

// Each <button …> start tag as [start, end) offsets. A tag ends at the first
// > outside quotes and braces, so on:click={() => …} doesn't end it.
function buttonTags(text) {
  const tags = [];
  for (const match of text.matchAll(/<button\b/g)) {
    let depth = 0;
    let quote = null;
    let i = match.index + match[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (depth === 0 && quote) {
        if (c === quote) quote = null;
        else if (c === "{") depth++;
      } else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && (c === '"' || c === "'")) quote = c;
      else if (depth === 0 && c === ">") break;
    }
    tags.push([match.index, i + 1]);
  }
  return tags;
}

// A line ending in an operator, or followed by one starting with one, goes
// on to the next: "btn btn-sm " +\n ($modeCurrent ? "variant-…" : …).
const CONTINUES = /[+?:=(,]\s*$/;
const CONTINUATION = /^\s*[+?:)]/;

// Class strings that style an action button: every <button> tag with btn in
// it, and every expression with btn outside a tag (consts, helper calls,
// Skeleton props such as buttonNeutral).
function buttonSpans(text) {
  const spans = buttonTags(text).filter(([s, e]) => BTN.test(text.slice(s, e)));
  const inTag = (i) => spans.some(([s, e]) => i >= s && i < e);
  const lines = text.split("\n");
  const starts = [];
  lines.reduce((offset, line) => (starts.push(offset), offset + line.length + 1), 0);
  for (let i = 0; i < lines.length; i++) {
    if (!BTN.test(lines[i]) || inTag(starts[i])) continue;
    let last = i;
    while (last + 1 < lines.length && (CONTINUES.test(lines[last]) || CONTINUATION.test(lines[last + 1]))) last++;
    spans.push([starts[i], starts[last] + lines[last].length]);
  }
  return spans;
}

function scan() {
  const found = new Map(); // `${file}\0${token}` -> ["file:line: token", …]
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path);
    const text = readFileSync(path, "utf8");
    const seen = new Set();
    for (const [start, end] of buttonSpans(text)) {
      const span = text.slice(start, end);
      const hits = [
        ...[...span.matchAll(VARIANT)].filter((m) => !THEME_VARIANTS.has(m[0])),
        ...span.matchAll(BORDER),
      ];
      for (const m of hits) {
        const at = start + m.index;
        if (seen.has(at)) continue;
        seen.add(at);
        const line = text.slice(0, at).split("\n").length;
        const key = `${file}\0${m[0]}`;
        found.set(key, [...(found.get(key) ?? []), `${file}:${line}: ${m[0]}`]);
      }
    }
  }
  return found;
}

test("action buttons use the theme variants and no border or ring", () => {
  const found = scan();
  const offenders = [];
  for (const [key, hits] of found) {
    const [file, token] = key.split("\0");
    const entry = GRANDFATHERED.find((e) => e.file === file && e.token === token);
    if (!entry || hits.length > entry.count) offenders.push(...hits);
  }
  assert.deepEqual(
    offenders,
    [],
    "Buttons follow the theme variant for light and dark mode and have no borders: use " +
      "primaryVariant($modeCurrent) (or tertiaryVariant / neutralVariant) from lib/launchpad/format.js " +
      `instead of a one-off variant, and drop border and ring classes. Allowed variants: ${[...THEME_VARIANTS].join(", ")}.\n` +
      offenders.join("\n"),
  );
});

test("every grandfathered button entry still has exactly its count", () => {
  const found = scan();
  const wrong = GRANDFATHERED.filter((e) => (found.get(`${e.file}\0${e.token}`)?.length ?? 0) !== e.count).map(
    (e) => `${e.file} ${e.token}: listed ${e.count}, found ${found.get(`${e.file}\0${e.token}`)?.length ?? 0}`,
  );
  assert.deepEqual(wrong, [], "Lower or remove these GRANDFATHERED entries in buttonVariants.test.js");
});

test("the theme variants are the ghost/filled pairs", () => {
  assert.deepEqual(
    [...THEME_VARIANTS].sort(),
    ["variant-filled", "variant-filled-primary", "variant-filled-tertiary", "variant-ghost", "variant-ghost-primary", "variant-ghost-tertiary"],
  );
});
