// Waypoints over the service: createWaypointStore (over a fake service
// client) keeps the host → override map Settings shows, and saves a
// waypoint as add-or-update, as the Go binding did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWaypointStore } from "./createWaypointStore.js";
import { serviceError } from "../lib/service/errors.js";

// The service's waypoint routes over an in-memory list, recording calls.
function fakeService(initial = []) {
  let items = initial.map((item) => ({ ...item }));
  const calls = [];
  const list = () => ({ items: items.map((item) => ({ ...item })) });
  return {
    calls,
    get: async (path) => {
      calls.push(["GET", path]);
      assert.equal(path, "/waypoint");
      return list();
    },
    post: async (path, body) => {
      calls.push(["POST", path, body]);
      const known = items.some((item) => item.hostname === body.hostname);
      if (path === "/waypoint") {
        if (known) throw serviceError({ method: "POST", path, status: 409, body: { error: "waypoint_already_exists" } });
        items.push({ ...body });
      } else if (path === "/waypoint/update") {
        items = items.map((item) => (item.hostname === body.hostname ? { ...body } : item));
      } else {
        throw serviceError({ method: "POST", path, status: 404, body: null, text: "404 page not found" });
      }
      return list();
    },
    del: async (path, body) => {
      calls.push(["DELETE", path, body]);
      items = items.filter((item) => item.hostname !== body.hostname);
      return list();
    },
  };
}

test("load reads the waypoints as a host to override map", async () => {
  const store = createWaypointStore(fakeService([{ hostname: "a.test:443", override: "127.0.0.1:8443" }]));
  await store.load();
  assert.deepEqual(get(store), { "a.test:443": "127.0.0.1:8443" });
});

test("saving a new waypoint adds it", async () => {
  const client = fakeService();
  const store = createWaypointStore(client);
  await store.save("a.test:443", "127.0.0.1:8443");
  assert.deepEqual(get(store), { "a.test:443": "127.0.0.1:8443" });
  assert.deepEqual(client.calls.map(([method, path]) => `${method} ${path}`), ["POST /waypoint"]);
});

test("saving a waypoint the service already has updates it", async () => {
  const client = fakeService([{ hostname: "a.test:443", override: "127.0.0.1:8443" }]);
  const store = createWaypointStore(client);
  await store.save("a.test:443", "127.0.0.1:9443");
  assert.deepEqual(get(store), { "a.test:443": "127.0.0.1:9443" });
  assert.deepEqual(client.calls.map(([method, path]) => `${method} ${path}`), ["POST /waypoint", "POST /waypoint/update"]);
});

test("a refused save passes the error on and keeps the map", async () => {
  const client = fakeService();
  client.post = async (path) => {
    throw serviceError({ method: "POST", path, status: 400, body: { error: "invalid_waypoint_request" } });
  };
  const store = createWaypointStore(client);
  await assert.rejects(store.save("bad", ""), /invalid_waypoint_request/);
  assert.deepEqual(get(store), {});
});

test("removing a waypoint sends its host in the body", async () => {
  const client = fakeService([{ hostname: "a.test:443", override: "127.0.0.1:8443" }]);
  const store = createWaypointStore(client);
  await store.remove("a.test:443");
  assert.deepEqual(get(store), {});
  assert.deepEqual(client.calls.at(-1), ["DELETE", "/waypoint", { hostname: "a.test:443" }]);
});

test("a waypoint event from another client replaces the map", () => {
  const store = createWaypointStore(fakeService());
  store.onChanged({ items: [{ hostname: "b.test:80", override: "127.0.0.1:8080" }] });
  assert.deepEqual(get(store), { "b.test:80": "127.0.0.1:8080" });
});

test("clear forgets the last project's waypoints", async () => {
  const store = createWaypointStore(fakeService([{ hostname: "a.test:443", override: "x:1" }]));
  await store.load();
  store.clear();
  assert.deepEqual(get(store), {});
});

test("a load the project switch superseded changes nothing when its answer comes late", async () => {
  let answer;
  const answers = [new Promise((resolve) => (answer = resolve)), Promise.resolve({ items: [{ hostname: "b.test", override: "127.0.0.1" }] })];
  const store = createWaypointStore({ get: () => answers.shift() });
  const superseded = store.load();
  store.clear();
  await store.load();
  answer({ items: [{ hostname: "a.test", override: "10.0.0.1" }] });
  await superseded;
  assert.deepEqual(get(store), { "b.test": "127.0.0.1" });
});
