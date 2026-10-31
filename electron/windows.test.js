import { test } from "node:test";
import assert from "node:assert/strict";
import { createWindowList } from "./windows.js";

// Window connections by webContents id, as local.js keeps them.
function fakeConnections(byId) {
  const connections = new Map(Object.entries(byId).map(([id, instance]) => [Number(id), { instance }]));
  return { connections, connectionOf: (id) => connections.get(id) };
}

test("the list has the connected windows, by instance and project, in the order they opened", () => {
  const { connectionOf } = fakeConnections({ 1: "default", 3: "acme" });
  const windows = createWindowList({ connectionOf });
  [1, 2, 3].forEach((id) => windows.opened(id));
  windows.setProject(1, "scratchpad");
  windows.setProject(3, "acme-web");
  assert.deepEqual(windows.list(3), [
    { id: 1, instance: "default", project: "scratchpad", label: "default — scratchpad", focused: false },
    { id: 3, instance: "acme", project: "acme-web", label: "acme — acme-web", focused: true },
  ]);
});

test("a window whose project hasn't opened yet is listed by its instance", () => {
  const { connectionOf } = fakeConnections({ 4: "acme" });
  const windows = createWindowList({ connectionOf });
  windows.opened(4);
  assert.deepEqual(windows.list(null), [{ id: 4, instance: "acme", project: null, label: "acme", focused: false }]);
});

test("the dock badge counts the held items of every window, and a closed or disconnected window's go", () => {
  const { connections, connectionOf } = fakeConnections({ 1: "default", 2: "acme", 3: "beta" });
  const windows = createWindowList({ connectionOf });
  [1, 2, 3].forEach((id) => windows.opened(id));
  windows.setHeld(1, 2);
  windows.setHeld(2, 5);
  windows.setHeld(3, 1);
  assert.equal(windows.held(), 8);
  windows.closed(2);
  assert.equal(windows.held(), 3);
  connections.delete(3);
  windows.disconnected(3);
  assert.equal(windows.held(), 2);
  assert.deepEqual(
    windows.list(null).map((w) => w.id),
    [1],
  );
});

test("a disconnected window forgets its project, so a new connection isn't listed under the old one", () => {
  const { connections, connectionOf } = fakeConnections({ 1: "default" });
  const windows = createWindowList({ connectionOf });
  windows.opened(1);
  windows.setProject(1, "scratchpad");
  windows.disconnected(1);
  connections.set(1, { instance: "acme" });
  assert.equal(windows.list(null)[0].label, "acme");
});
