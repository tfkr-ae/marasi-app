import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWindowListStore } from "./createWindowListStore.js";

const item = (id, instance, project, current = false) => ({
  id,
  instance,
  project,
  label: project ? `${instance} — ${project}` : instance,
  current,
});

// A fake main-process bridge: `list` is the connected windows it reports,
// and `change()` fires its windows-changed event.
function fakeBridge(list) {
  const calls = [];
  let listener = null;
  const api = {
    windows: async () => list,
    focusWindow: async (id) => calls.push(["focus", id]),
    newWindow: async () => calls.push(["new"]),
    onWindowsChanged: (fn) => {
      listener = fn;
      return () => (listener = null);
    },
    reportProject: async (name) => calls.push(["project", name]),
    reportHeld: async (count) => calls.push(["held", count]),
  };
  return {
    api,
    calls,
    setList: (next) => (list = next),
    change: () => listener?.(),
    following: () => listener !== null,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the store follows the connected windows as they change, until it stops", async () => {
  const bridge = fakeBridge([item(1, "default", "scratchpad", true)]);
  const windows = createWindowListStore(bridge.api);
  const stop = windows.follow();
  await settle();
  assert.deepEqual(get(windows), [item(1, "default", "scratchpad", true)]);
  bridge.setList([item(1, "default", "scratchpad", true), item(2, "acme", null)]);
  bridge.change();
  await settle();
  assert.deepEqual(
    get(windows).map((w) => w.label),
    ["default — scratchpad", "acme"],
  );
  stop();
  assert.equal(bridge.following(), false);
});

test("switching brings the chosen window to the front; the current one stays as it is", async () => {
  const bridge = fakeBridge([]);
  const windows = createWindowListStore(bridge.api);
  await windows.switchTo(item(2, "acme", "acme-web"));
  await windows.switchTo(item(1, "default", null, true));
  assert.deepEqual(bridge.calls, [["focus", 2]]);
});

test("a new window is asked of the main process", async () => {
  const bridge = fakeBridge([]);
  await createWindowListStore(bridge.api).newWindow();
  assert.deepEqual(bridge.calls, [["new"]]);
});

test("the held count and the project reach the main process only when they change", async () => {
  const bridge = fakeBridge([]);
  const windows = createWindowListStore(bridge.api);
  [0, 2, 2, 3, 0].forEach((count) => windows.reportHeld(count));
  ["scratchpad", "scratchpad", "acme-web"].forEach((name) => windows.reportProject(name));
  assert.deepEqual(bridge.calls, [
    ["held", 2],
    ["held", 3],
    ["held", 0],
    ["project", "scratchpad"],
    ["project", "acme-web"],
  ]);
});
