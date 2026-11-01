// The open project's waypoints, which Settings → Waypoints shows as v1's
// {hostname: override} map: read after each change, and the waypoint.* events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWaypointStore } from "./createWaypointStore.js";

function setup() {
  const calls = [];
  let map = { "a.test": "127.0.0.1:8000" };
  const api = {
    list: async () => (calls.push(["list"]), { ...map }),
    save: async (host, override) => (calls.push(["save", host, override]), (map = { ...map, [host]: override })),
    remove: async (host) => {
      calls.push(["remove", host]);
      const { [host]: _, ...rest } = map;
      map = rest;
    },
  };
  return { store: createWaypointStore(api), calls };
}

test("reload reads the project's waypoints", async () => {
  const { store } = setup();
  await store.reload();
  assert.deepEqual(get(store), { "a.test": "127.0.0.1:8000" });
});

test("save and remove show the list after the change", async () => {
  const { store, calls } = setup();
  await store.save("b.test", "10.0.0.1:443");
  assert.deepEqual(get(store), { "a.test": "127.0.0.1:8000", "b.test": "10.0.0.1:443" });
  await store.remove("a.test");
  assert.deepEqual(get(store), { "b.test": "10.0.0.1:443" });
  assert.deepEqual(calls, [["save", "b.test", "10.0.0.1:443"], ["list"], ["remove", "a.test"], ["list"]]);
});

test("a waypoint.* event shows the CLI's change", () => {
  const { store } = setup();
  store.onWaypoints({ items: [{ hostname: "c.test", override: "127.0.0.1:9000" }] });
  assert.deepEqual(get(store), { "c.test": "127.0.0.1:9000" });
});

test("clear empties the map for the next project", async () => {
  const { store } = setup();
  await store.reload();
  store.clear();
  assert.deepEqual(get(store), {});
});
