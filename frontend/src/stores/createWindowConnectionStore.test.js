import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWindowConnectionStore, instanceNameFor } from "./createWindowConnectionStore.js";

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
function fakeApi({ instances = [], connect, current = null, startup = current } = {}) {
  const fetched = [];
  const connected = [];
  const started = [];
  const calls = [];
  let marasi = { path: null, bundled: "/app/resources/bin/marasi" };
  const api = {
    startup: async () => (typeof startup === "function" ? startup() : startup),
    start: async (instance, project) => {
      started.push([instance, project]);
      connected.push(instance);
      return { instance, baseURL: "http://127.0.0.1:50100", loopbackTurnedOn: false };
    },
    disconnect: async () => calls.push("disconnect"),
    marasi: async () => marasi,
    chooseMarasi: async (bundled) => {
      marasi = { ...marasi, path: bundled ? null : "/opt/marasi-dev/marasi" };
      return marasi;
    },
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
  return { api, fetched, connected, started, calls };
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

test("at launch the window takes up the connection the main process made, as after a reload", async () => {
  const { api, fetched, connected } = fakeApi({
    startup: { instance: "default", baseURL: "http://127.0.0.1:4000", loopbackTurnedOn: false },
  });
  const store = createWindowConnectionStore(api);
  const connection = await store.startup();
  assert.equal(connection.instance, "default");
  assert.deepEqual(connected, []);
  assert.deepEqual(fetched, ["http://127.0.0.1:4000/service/status"]);
});

test("a window with no connection to take up gets none", async () => {
  const { api } = fakeApi();
  const store = createWindowConnectionStore(api);
  assert.equal(await store.startup(), null);
  assert.equal(get(store).connection, null);
});

test("a startup that couldn't start the default instance says why", async () => {
  const { api } = fakeApi({
    startup: () => {
      throw new Error("Error invoking remote method 'connection:startup': Error: listen tcp 127.0.0.1:8080: address already in use");
    },
  });
  const store = createWindowConnectionStore(api);
  assert.equal(await store.startup(), null);
  assert.equal(get(store).connectError, "listen tcp 127.0.0.1:8080: address already in use");
});

test("Start starts the named instance on the project and connects", async () => {
  const { api, started, fetched } = fakeApi();
  const store = createWindowConnectionStore(api);
  const connection = await store.start("acme", "/work/acme.marasi");
  assert.deepEqual(started, [["acme", "/work/acme.marasi"]]);
  assert.deepEqual(fetched, ["http://127.0.0.1:50100/service/status"]);
  assert.equal(connection.instance, "acme");
  assert.equal(get(store).connecting, null);
});

test("a refused Start stays on the screen with Marasi's reason", async () => {
  const { api } = fakeApi();
  api.start = async () => {
    throw new Error("Error invoking remote method 'connection:start': Error: instance acme is already running");
  };
  const store = createWindowConnectionStore(api);
  assert.equal(await store.start("acme", null), null);
  assert.equal(get(store).connection, null);
  assert.equal(get(store).connectError, "instance acme is already running");
});

test("disconnecting ends the window's connection", async () => {
  const { api, calls } = fakeApi();
  const store = createWindowConnectionStore(api);
  await store.connect("default");
  await store.disconnect();
  assert.deepEqual(calls, ["disconnect"]);
  assert.equal(get(store).connection, null);
});

test("Start names an instance after its project's file, with a suffix when taken", () => {
  assert.equal(instanceNameFor("/work/acme.marasi", []), "acme");
  assert.equal(instanceNameFor("C:\\work\\Acme Corp.marasi", []), "Acme Corp");
  assert.equal(instanceNameFor("/work/acme.marasi", ["acme", "acme-2", "default"]), "acme-3");
  assert.equal(instanceNameFor(null, []), "scratchpad");
  assert.equal(instanceNameFor(null, ["scratchpad"]), "scratchpad-2");
});

test("the Marasi Start runs is the bundled one until a path is chosen", async () => {
  const { api } = fakeApi();
  const store = createWindowConnectionStore(api);
  await store.readMarasi();
  assert.deepEqual(get(store).marasi, { path: null, bundled: "/app/resources/bin/marasi" });
  await store.chooseMarasi();
  assert.equal(get(store).marasi.path, "/opt/marasi-dev/marasi");
  await store.chooseMarasi(true);
  assert.equal(get(store).marasi.path, null);
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
