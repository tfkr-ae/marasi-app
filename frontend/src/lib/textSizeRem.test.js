import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Text size scales the root font size, so a text size in px doesn't follow it
// (docs/adr/2026-10-29-text-size-scales-the-root-font-size.md). Use text-2xs,
// text-3xs or another rem size instead.

const SRC = fileURLToPath(new URL("..", import.meta.url));
// Generated Wails bindings.
const SKIP = new Set(["wailsjs"]);
const EXTENSIONS = [".svelte", ".js", ".css"];
const PX_FONT_SIZE = [
  /text-\[\d*\.?\d+px\]/,
  /font-size:\s*\d*\.?\d+px/,
  /fontSize:\s*["']\d*\.?\d+px["']/,
];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sourceFiles(path);
    return EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".test.js")
      ? [path]
      : [];
  });
}

test("no text size in the frontend is written in px", () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (PX_FONT_SIZE.some((pattern) => pattern.test(line))) {
          offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(offenders, [], `Text sizes in px don't follow Text size:\n${offenders.join("\n")}`);
});
