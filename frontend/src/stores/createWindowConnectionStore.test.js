import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWindowConnectionStore } from "./createWindowConnectionStore.js";

const status = (instance, extra = {}) => ({
  status: "running",
  version: "v2-backlog-3a55b06 (dev)",
  instance,
  project: `/cfg/projects/${instance}.marasi`,
  proxy_listener: "127.0.0.1:8080",
  control_listener: "127.0.0.1:50037",
  ...extra,
});

// A fake main-process bridge and client module. `fetched` records the
// routes the client fetched, by base URL.
function fakeApi({ instances = [], connect, current = null } = {}) {
  const fetched = [];
  const connected = [];
  const api = {
    listInstances: async () => instances,
    connect: async (instance) => {
      connected.push(instance);
      if (connect) return connect(instance);
      return { instance, baseURL: "http://127.0.0.1:50037", loopbackTurnedOn: false };
    },
    current: async () => current,
    useConnection: (baseURL) => ({
      get: async (path) => {
        fetched.push(`${baseURL}${path}`);
        return status(current?.instance ?? connected.at(-1) ?? "default");
      },
    }),
  };
  return { api, fetched, connected };
}

test("the screen lists the running instances, healthy ones first by name", async () => {
  const { api } = fakeApi({
    instances: [status("zeta"), { status: "unhealthy", instance: "broken" }, status("acme")],
  });
  const store = createWindowConnectionStore(api);
  await store.listInstances();
  assert.deepEqual(
    get(store).instances.map((item) => [item.instance, item.healthy]),
    [
      ["acme", true],
      ["zeta", true],
      ["broken", false],
    ],
  );
  assert.equal(get(store).listing, false);
});

test("listing that fails says why and lists nothing", async () => {
  const { api } = fakeApi();
  api.listInstances = async () => {
    throw new Error("Error invoking remote method 'instances:list': Error: EACCES: permission denied");
  };
  const store = createWindowConnectionStore(api);
  await store.listInstances();
  assert.deepEqual(get(store).instances, []);
  assert.equal(get(store).listError, "EACCES: permission denied");
});

test("connecting fetches the instance's status through the client module", async () => {
  const { api, fetched, connected } = fakeApi({ instances: [status("default")] });
  const store = createWindowConnectionStore(api);
  const connection = await store.connect("default");
  assert.deepEqual(connected, ["default"]);
  assert.deepEqual(fetched, ["http://127.0.0.1:50037/service/status"]);
  assert.equal(connection.instance, "default");
  assert.equal(get(store).connection.status.project, "/cfg/projects/default.marasi");
  assert.equal(get(store).connecting, null);
  // The renderer's view of the connection holds no token.
  assert.equal(JSON.stringify(get(store).connection).includes("token"), false);
});

test("a connection that turned on a loopback address says so", async () => {
  const { api } = fakeApi({
    connect: (instance) => ({ instance, baseURL: "http://127.0.0.1:61000", loopbackTurnedOn: true }),
  });
  const store = createWindowConnectionStore(api);
  await store.connect("default");
  assert.equal(get(store).connection.loopbackTurnedOn, true);
});

test("a failed connect stays on the screen with a short reason", async () => {
  const { api } = fakeApi({
    connect: () => {
      throw new Error("Error invoking remote method 'connection:connect': Error: gone isn't running");
    },
  });
  const store = createWindowConnectionStore(api);
  assert.equal(await store.connect("gone"), null);
  assert.equal(get(store).connection, null);
  assert.equal(get(store).connectError, "gone isn't running");
  assert.equal(get(store).connecting, null);
  // Listing again keeps the reason on screen.
  await store.listInstances();
  assert.equal(get(store).connectError, "gone isn't running");
});

test("a window that reloads keeps the connection it had", async () => {
  const { api, fetched, connected } = fakeApi({
    current: { instance: "acme", baseURL: "http://127.0.0.1:4000", loopbackTurnedOn: false },
  });
  const store = createWindowConnectionStore(api);
  const connection = await store.resume();
  assert.equal(connection.instance, "acme");
  assert.deepEqual(connected, []);
  assert.deepEqual(fetched, ["http://127.0.0.1:4000/service/status"]);
});

test("a window with no connection resumes none", async () => {
  const { api } = fakeApi();
  const store = createWindowConnectionStore(api);
  assert.equal(await store.resume(), null);
  assert.equal(get(store).connection, null);
});

test("connected() waits for the window's connection", async () => {
  const { api } = fakeApi();
  const store = createWindowConnectionStore(api);
  let got = null;
  const waiting = store.connected().then((connection) => (got = connection));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(got, null);
  await store.connect("default");
  await waiting;
  assert.equal(got.instance, "default");
  // Once connected, it resolves at once.
  assert.equal((await store.connected()).instance, "default");
});
