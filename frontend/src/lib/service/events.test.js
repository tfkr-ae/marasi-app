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

// Names svc/events-b subscribes to. That branch adds their handlers; merging
// it empties this list, and the last test below fails until it does.
const PENDING_SVC_EVENTS_B = [
  "finding.created",
  "finding.updated",
  "finding.deleted",
  "finding.linked",
  "finding.unlinked",
  "test-case.created",
  "test-case.updated",
  "test-case.deleted",
  "test-case.linked",
  "test-case.unlinked",
  "artifact.created",
  "artifact.deleted",
  "report.template.added",
  "report.template.removed",
  "report.template.restored",
  "chrome.profile.added",
  "chrome.profile.removed",
  "chrome.path.added",
  "chrome.path.removed",
  "job.progress",
  "service.restarting",
  "service.restart_failed",
  "update.available",
  "update.progress",
  "update.installed",
  "update.failed",
];

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

function appSubscriptions() {
  const names = new Set();
  for (const dir of ["stores", "lib"]) {
    for (const file of sourceFiles(join(src, dir))) {
      for (const name of subscribedNames(readFileSync(file, "utf8"))) names.add(name);
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

test("the event list names each event once, apart from the stream's own", () => {
  assert.equal(new Set(SERVICE_EVENTS).size, SERVICE_EVENTS.length);
  for (const name of STREAM_EVENTS) assert.ok(!SERVICE_EVENTS.includes(name), name);
  for (const name of PENDING_SVC_EVENTS_B) assert.ok(SERVICE_EVENTS.includes(name), `${name} isn't a service event`);
});

test("every event the service publishes has a subscription in the app", () => {
  const subscribed = appSubscriptions();
  const missing = SERVICE_EVENTS.filter((name) => !subscribed.has(name) && !PENDING_SVC_EVENTS_B.includes(name));
  assert.deepEqual(missing, [], `no service.on(…) for: ${missing.join(", ")}`);
});

test("a pending name leaves the allowlist once it has a subscription", () => {
  const subscribed = appSubscriptions();
  const done = PENDING_SVC_EVENTS_B.filter((name) => subscribed.has(name));
  assert.deepEqual(done, [], `remove from PENDING_SVC_EVENTS_B: ${done.join(", ")}`);
});

test("the client handles stream.reset itself", () => {
  const client = readFileSync(join(src, "lib", "service", "client.js"), "utf8");
  assert.match(client, /addEventListener\("stream\.reset"/);
});
