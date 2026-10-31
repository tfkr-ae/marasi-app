import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as App from "./App.js";

// docs/v2-parity.md is the acceptance checklist for v2: one row per v1 Wails
// binding and per v1 event. These tests keep it complete as tickets land.
const parityPath = new URL("../../../../docs/v2-parity.md", import.meta.url);

function parityRows() {
  // The former gaps section is a cross-reference, not a checklist.
  return readFileSync(parityPath, "utf8")
    .split("## Former gaps")[0]
    .split("\n")
    .filter((line) => /^\| `/.test(line))
    .map((line) => {
      const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
      const [name, kind, status, v2, ticket, done] = cells;
      return { name: name.replace(/`/g, ""), kind, status, v2, ticket, done, line };
    });
}

function rowsOfKind(kind) {
  return parityRows().filter((row) => row.kind === kind);
}

test("every v1 binding has exactly one row", () => {
  const names = rowsOfKind("binding").map((row) => row.name);
  for (const binding of Object.keys(App)) {
    assert.equal(names.filter((name) => name === binding).length, 1, binding);
  }
});

// Every event v1's Go emitted or listened to, and every Wails runtime
// function its frontend imported, read from v1's source on main.
const v1Events = [
  "request", "response", "log", "project-opening",
  "intercepted", "checkpoint-settled", "checkpoint-abandoned",
  "ws-intercepted", "ws-message", "ws-open", "ws-close", "ws-progress", "ws-state",
  "launch-started", "launch-finished",
  "extension_gui_render", "extension_state_update", "<extensionName>-log",
  "update-available", "update-progress", "update-installed", "update-failed",
  "extension_call_function", "extension_sync_state",
];
const v1Runtime = ["EventsOn", "EventsOff", "EventsOnce", "EventsEmit", "WindowSetTitle", "BrowserOpenURL"];

test("every v1 event and runtime function has exactly one row", () => {
  for (const [kind, expected] of [["event", v1Events], ["runtime", v1Runtime]]) {
    const names = rowsOfKind(kind).map((row) => row.name);
    for (const name of expected) {
      assert.equal(names.filter((other) => other === name).length, 1, name);
    }
    assert.deepEqual(names.filter((name) => !expected.includes(name)), [], `unknown ${kind} rows`);
  }
});

test("every row is covered, done by the GUI, or one of the two dropped migrations", () => {
  const rows = parityRows();
  for (const row of rows) {
    assert.ok(["COVERED", "GUI", "DROPPED"].includes(row.status), row.line);
    assert.ok(row.v2, row.line);
  }
  assert.deepEqual(
    rows.filter((row) => row.status === "DROPPED").map((row) => row.name).sort(),
    ["MigrateOldHighlights", "migrateLegacyExclusion"],
  );
});

test("every covered row names a route or event", () => {
  for (const row of parityRows().filter((row) => row.status === "COVERED")) {
    assert.match(row.v2, /`(GET|POST|PUT|DELETE) \/|`[a-z_]+\.[a-z_.*]+|`marasi /, row.line);
  }
});

test("every row names the ticket that ports it and has a done box", () => {
  for (const row of parityRows()) {
    assert.match(row.ticket, /^(0[1-9]|1[0-9]|2[0-8])$/, row.line);
    assert.match(row.done, /^\[[ x]\]$/, row.line);
  }
});
