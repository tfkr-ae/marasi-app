// Chrome paths and profiles live in this machine's marasi_config.yaml, so
// the service's chrome.* events describe them only on the local connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeConfigEvents } from "./chromeConfigEvents.js";

function setup(kind) {
  const reads = [];
  const events = chromeConfigEvents({
    connectionKind: () => kind,
    onPaths: () => reads.push("paths"),
    onProfiles: () => reads.push("profiles"),
  });
  return { events, reads };
}

test("on the local connection a Chrome change from the CLI rereads that list", () => {
  const { events, reads } = setup("local");
  events["chrome.path.added"]({ items: [{ os: "darwin", path: "/Applications/Chrome.app" }] });
  events["chrome.path.removed"]({ items: [] });
  events["chrome.profile.added"]({ items: [{ name: "work" }] });
  events["chrome.profile.removed"]({ items: [] });
  assert.deepEqual(reads, ["paths", "paths", "profiles", "profiles"]);
});

test("on a remote connection Chrome changes are the remote host's and are ignored", () => {
  const { events, reads } = setup("remote");
  for (const handler of Object.values(events)) handler({ items: [] });
  assert.deepEqual(reads, []);
});
