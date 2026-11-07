// Each project loaded joins the recents of the connection it loaded on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackRecents } from "./recentProjects.js";

function tracker() {
  const added = [];
  const loaded = [];
  let id = "local";
  const announce = trackRecents({
    connectionId: () => id,
    addRecent: (connection, name, path) => added.push([connection, name, path]),
    onLoaded: (path) => loaded.push(path),
  });
  return { added, loaded, announce, switchTo: (next) => (id = next) };
}

test("a loaded project joins the active connection's recents", () => {
  const t = tracker();
  t.announce({ name: "scratchpad", path: "/l/scratchpad.marasi" });
  assert.deepEqual(t.added, [["local", "scratchpad", "/l/scratchpad.marasi"]]);
  assert.deepEqual(t.loaded, ["/l/scratchpad.marasi"]);
});

test("the last project announced again after a switch stays out of the new connection's recents", () => {
  const t = tracker();
  const local = { name: "scratchpad", path: "/l/scratchpad.marasi" };
  t.announce(local);
  t.switchTo("lab");
  t.announce(local);
  t.announce({ name: "remotework", path: "/r/remotework.marasi" });
  assert.deepEqual(t.added, [
    ["local", "scratchpad", "/l/scratchpad.marasi"],
    ["lab", "remotework", "/r/remotework.marasi"],
  ]);
});

test("the same project loaded again on the same connection is added once", () => {
  const t = tracker();
  t.announce({ name: "a", path: "/a.marasi" });
  t.announce({ name: "a", path: "/a.marasi" });
  assert.equal(t.added.length, 1);
});

test("nothing loaded adds nothing", () => {
  const t = tracker();
  t.announce(null);
  assert.deepEqual(t.added, []);
});
