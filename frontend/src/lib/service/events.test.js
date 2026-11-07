// Every event the service publishes (events.js) has a `.on(name, …)`
// subscription somewhere in the app's stores or lib, so another client's
// change never waits for a resync. The scan reads the source: a name counts
// when a file calls `.on("name"`, or when it lists the name in an array and
// subscribes through a variable (`for (const name of [...]) service.on(name, …)`,
// `names.map((name) => client.on(name, …))`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_EVENTS, STREAM_EVENTS } from "./events.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "bindings") files.push(...sourceFiles(path));
    } else if (/\.(js|svelte)$/.test(name) && !/\.test\.js$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

// Drops comments, so a name in one never counts. A `//` after a colon is a
// URL in a string, not a comment.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const EVENT_NAME = String.raw`[a-z][a-z_-]*(?:\.[a-z_-]+)+`;

/** The event names a source text subscribes to. */
export function subscribedNames(text) {
  const code = withoutComments(text);
  const names = new Set();
  for (const [, name] of code.matchAll(new RegExp(String.raw`\.on\(\s*["'\`](${EVENT_NAME})["'\`]`, "g"))) {
    names.add(name);
  }
  if (/\.on\(\s*[A-Za-z_$]/.test(code)) {
    for (const [array] of code.matchAll(/\[[^[\]]*\]/g)) {
      for (const [, name] of array.matchAll(new RegExp(String.raw`["'](${EVENT_NAME})["']`, "g"))) names.add(name);
    }
  }
  return names;
}

// A file that subscribes with a variable name (`.on(name` or a bare
// `on(name`) can take its names from a list or handler map another file
// exports, such as `Object.entries(logbookEvents(store))`. Those names count
// when the subscribing file uses the export.
const subscribesByVariable = (code) => /\bon\(\s*[A-Za-z_$]/.test(code);

/** The quoted event names in a source's arrays and object keys. */
export function listedNames(text) {
  const code = withoutComments(text);
  const names = new Set();
  for (const [, name] of code.matchAll(new RegExp(String.raw`["'](${EVENT_NAME})["']\s*[:,\]]`, "g"))) names.add(name);
  return names;
}

function appSubscriptions() {
  const files = ["stores", "lib", "routes"].flatMap((dir) => sourceFiles(join(src, dir)));
  const code = new Map(files.map((file) => [file, withoutComments(readFileSync(file, "utf8"))]));
  const exporters = new Map();
  for (const [file, text] of code) {
    for (const [, name] of text.matchAll(/export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/g)) exporters.set(name, file);
  }
  const names = new Set();
  for (const [file, text] of code) {
    for (const name of subscribedNames(text)) names.add(name);
    if (!subscribesByVariable(text)) continue;
    for (const name of listedNames(text)) names.add(name);
    for (const [ident, from] of exporters) {
      if (from !== file && new RegExp(String.raw`\b${ident.replace(/\$/g, "\\$")}\b`).test(text)) {
        for (const name of listedNames(code.get(from))) names.add(name);
      }
    }
  }
  return names;
}

test("the scan counts direct subscriptions and names a variable subscribes to", () => {
  const text = `
    service.on("traffic.request", onRequest);
    // service.on("commented.out", nothing);
    for (const name of ["waypoint.added", "waypoint.removed"]) service.on(name, changed);
    const url = "http://example.com/a.b";`;
  assert.deepEqual([...subscribedNames(text)].sort(), ["traffic.request", "waypoint.added", "waypoint.removed"]);
  assert.deepEqual([...subscribedNames(`const names = ["a.b"]; service.on("c.d", f);`)], ["c.d"]);
});

test("a handler map's keys and a list's items are listed names", () => {
  const map = `export const handlers = () => ({ "finding.created": f, "chrome.path.added": g });
    export const NAMES = ["update.available", "update.failed"];
    // "commented.out": nothing
    const url = "http://example.com/a.b";`;
  assert.deepEqual([...listedNames(map)].sort(), ["chrome.path.added", "finding.created", "update.available", "update.failed"]);
});

test("the event list names each event once, apart from the stream's own", () => {
  assert.equal(new Set(SERVICE_EVENTS).size, SERVICE_EVENTS.length);
  for (const name of STREAM_EVENTS) assert.ok(!SERVICE_EVENTS.includes(name), name);
});

test("every event the service publishes has a subscription in the app", () => {
  const subscribed = appSubscriptions();
  const missing = SERVICE_EVENTS.filter((name) => !subscribed.has(name));
  assert.deepEqual(missing, [], `no service.on(…) for: ${missing.join(", ")}`);
});

test("the client handles stream.reset itself", () => {
  const client = readFileSync(join(src, "lib", "service", "client.js"), "utf8");
  assert.match(client, /addEventListener\("stream\.reset"/);
});
