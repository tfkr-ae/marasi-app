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
    refusedRemote: async () => null,
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

test("a connection taken up after a reload is marked resumed, so its loopback toast isn't shown again", async () => {
  const { api } = fakeApi({
    startup: { instance: "acme", baseURL: "http://127.0.0.1:4000", loopbackTurnedOn: true, resumed: true },
  });
  const connection = await createWindowConnectionStore(api).startup();
  assert.equal(connection.loopbackTurnedOn, true);
  assert.equal(connection.resumed, true);
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

// The bridge's remote calls, over a saved list, answering as the main
// process does: { value }, or { error, tokenRefused, remote }.
function remoteApi({ saved = [], tokens = {}, refused = null } = {}) {
  const { api, fetched } = fakeApi();
  const sent = [];
  const answer = (url, token, name) => {
    if (tokens[url] === undefined) return { error: `couldn't reach ${url}: ECONNREFUSED` };
    if (tokens[url] !== token) return { error: `${name ?? url} refused the token`, tokenRefused: true, remote: { name: name ?? url, url } };
    return { value: { instance: name ?? `default on ${new URL(url).host}`, baseURL: url, loopbackTurnedOn: false, remote: true } };
  };
  Object.assign(api, {
    listRemotes: async () => saved.map(({ name, url }) => ({ name, url })),
    connectRemote: async (form) => {
      sent.push(form);
      const result = answer(form.url, form.token, form.name || undefined);
      if (result.value && form.save) {
        saved = [...saved.filter((item) => item.url !== form.url), { name: result.value.instance, url: form.url, token: form.token }];
      }
      return result;
    },
    connectSaved: async (url) => {
      const item = saved.find((entry) => entry.url === url);
      return answer(url, item.token, item.name);
    },
    forgetRemote: async (url) => {
      saved = saved.filter((entry) => entry.url !== url);
    },
    refusedRemote: async () => refused,
  });
  return { api, fetched, sent };
}

test("a remote connects by address and token, and is remembered", async () => {
  const { api, fetched, sent } = remoteApi({ tokens: { "http://10.1.26.31:7070": "t1" } });
  const store = createWindowConnectionStore(api);
  const connection = await store.connectRemote({ url: "http://10.1.26.31:7070", token: "t1", name: "", save: true });
  assert.equal(connection.instance, "default on 10.1.26.31:7070");
  assert.equal(connection.remote, true);
  assert.deepEqual(fetched, ["http://10.1.26.31:7070/service/status"]);
  assert.deepEqual(sent, [{ url: "http://10.1.26.31:7070", token: "t1", name: "", save: true }]);
  assert.deepEqual(get(store).remotes, [{ name: "default on 10.1.26.31:7070", url: "http://10.1.26.31:7070" }]);
});

test("a saved remote connects without its token", async () => {
  const { api } = remoteApi({
    saved: [{ name: "Lab box", url: "http://10.1.26.31:7070", token: "t1" }],
    tokens: { "http://10.1.26.31:7070": "t1" },
  });
  const store = createWindowConnectionStore(api);
  await store.listRemotes();
  assert.deepEqual(get(store).remotes, [{ name: "Lab box", url: "http://10.1.26.31:7070" }]);
  const connection = await store.connectSaved("http://10.1.26.31:7070");
  assert.equal(connection.instance, "Lab box");
});

test("a saved remote that refuses its token asks for the new one, which replaces it", async () => {
  const tokens = { "http://10.1.26.31:7070": "rotated" };
  const { api, sent } = remoteApi({ saved: [{ name: "Lab box", url: "http://10.1.26.31:7070", token: "t1" }], tokens });
  const store = createWindowConnectionStore(api);
  assert.equal(await store.connectSaved("http://10.1.26.31:7070"), null);
  assert.deepEqual(get(store).tokenPrompt, { name: "Lab box", url: "http://10.1.26.31:7070" });
  assert.equal(get(store).connectError, "Lab box refused the token");
  const connection = await store.connectRemote({ url: "http://10.1.26.31:7070", token: "rotated", name: "Lab box", save: true });
  assert.equal(connection.instance, "Lab box");
  assert.equal(get(store).tokenPrompt, null);
  assert.equal(sent.at(-1).save, true);
});

test("a window whose remote refused its token comes back asking for the new one", async () => {
  const { api } = remoteApi({ refused: { name: "Lab box", url: "http://10.1.26.31:7070" } });
  const store = createWindowConnectionStore(api);
  assert.equal(await store.startup(), null);
  assert.deepEqual(get(store).tokenPrompt, { name: "Lab box", url: "http://10.1.26.31:7070" });
  assert.equal(get(store).connectError, "Lab box changed its token: paste the new one");
});

test("a remote that can't be reached stays on the screen with the reason; forgetting removes it", async () => {
  const { api } = remoteApi({ saved: [{ name: "Gone", url: "http://10.9.9.9:1", token: "x" }] });
  const store = createWindowConnectionStore(api);
  assert.equal(await store.connectRemote({ url: "http://10.9.9.9:1", token: "x", save: false }), null);
  assert.equal(get(store).connectError, "couldn't reach http://10.9.9.9:1: ECONNREFUSED");
  assert.equal(get(store).tokenPrompt, null);
  await store.forgetRemote("http://10.9.9.9:1");
  assert.deepEqual(get(store).remotes, []);
});
