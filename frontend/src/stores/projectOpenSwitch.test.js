// A project open chosen on one connection never reaches the next. The real
// connection store, project store, project api and service client run over
// a fake fetch whose answers wait for the test, wired as the app wires them
// (connectionServiceApi.js). An open that a connection switch overtakes
// resolves superseded and sends nothing to the new connection, whichever
// step it waited at and however the new connection fares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";
import { createProjectStore } from "./createProjectStore.js";
import { createProjectApi } from "./projectApi.js";
import { connectionServiceApi } from "./connectionServiceApi.js";
import { createServiceClient } from "../lib/service/client.js";

const alpha = { id: "alpha", kind: "remote", name: "Alpha", url: "http://a:9000" };
const beta = { id: "beta", kind: "remote", name: "Beta", url: "http://b:9000" };
const statusOf = (project) => ({ version: "dev", api: 1, run_id: `run-${project}`, project });

// A test that waits on a request nobody answers fails instead of hanging.
const it = (name, fn) => test(name, { timeout: 2000 }, fn);

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

// A fake fetch: every request waits until the test answers it with
// `reply(method, url, body)` or `refuse(method, url, status)`.
function fakeService() {
  const requests = [];
  const pending = [];
  const fetch = (url, init = {}) => {
    const request = { method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    const answer = deferred();
    pending.push({ ...request, answer });
    return answer.promise;
  };
  const take = (method, url) => {
    const at = pending.findIndex((r) => r.method === method && r.url === url);
    assert.notEqual(at, -1, `no pending ${method} ${url}`);
    return pending.splice(at, 1)[0];
  };
  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
  });
  return {
    fetch,
    requests,
    reply: (method, url, body) => take(method, url).answer.resolve(response(200, body)),
    refuse: (method, url, status) => take(method, url).answer.resolve(response(status, { error: "internal", message: "down" })),
    has: (method, url) => pending.some((r) => r.method === method && r.url === url),
  };
}

// The latest /events stream, whose `emit(name, data)` delivers an event.
function fakeStreams() {
  const streams = [];
  class EventSource {
    constructor(url) {
      this.url = String(url);
      this.listeners = new Map();
      streams.push(this);
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    close() {}
  }
  const emit = (name, data) => {
    const stream = streams.at(-1);
    for (const listener of stream.listeners.get(name) ?? []) listener({ data: JSON.stringify(data), lastEventId: "" });
  };
  return { EventSource, emit, streams };
}

function setup({ confirmOpen = async () => true, password = async (id) => `pw-${id}` } = {}) {
  const service = fakeService();
  const streams = fakeStreams();
  const client = createServiceClient({ fetch: service.fetch, EventSource: streams.EventSource });
  const loads = [];
  const projectStore = createProjectStore(
    createProjectApi(client, {
      confirmSwitch: () => confirmOpen(),
      loadProject: async (path, part, live) => loads.push({ path, live }),
    }),
    { setTimeout: () => 0, clearTimeout: () => {} },
  );
  const follows = [];
  const connectionStore = createConnectionStore(
    {
      ...connectionServiceApi(client, projectStore),
      listConnections: async () => ({ connections: [alpha, beta], activeId: "alpha" }),
      connectionPassword: async (id) => password(id),
      confirmSwitch: async () => true,
      confirmFollow: async (project) => (follows.push(project), true),
      setActive: async () => {},
      clearStores: () => {},
      resync: async () => {},
    },
    { setTimeout: () => 1, clearTimeout: () => {} },
  );
  // As +layout.svelte wires it: another client's opened project goes to
  // the connection store, which asks, then loads it.
  projectStore.follow({ opened: (path) => connectionStore.followSwitch(path) });
  return { service, client, projectStore, connectionStore, loads, follows, emit: streams.emit };
}

// Connects to Alpha with /a-current.marasi loaded.
async function onAlpha(fake) {
  fake.connectionStore.start();
  await settle();
  fake.service.reply("GET", "http://a:9000/service/status", statusOf("/a-current.marasi"));
  await settle();
  assert.equal(get(fake.connectionStore).phase, "connected");
  assert.equal(get(fake.projectStore).loaded.path, "/a-current.marasi");
}

const opensOn = (fake, host) =>
  fake.service.requests.filter((r) => r.method === "POST" && r.url === `http://${host}:9000/project/open`);

it("an open whose Checkpoint check answers after a switch to B never reaches B", async () => {
  const fake = setup();
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/chosen-on-a.marasi" });
  await settle();
  assert.ok(fake.service.has("GET", "http://a:9000/checkpoint"));
  fake.connectionStore.switchTo("beta");
  await settle();
  assert.ok(fake.service.has("GET", "http://b:9000/service/status"), "B's status waits");
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });

  assert.deepEqual(await opening, { status: "superseded" });
  await settle();
  assert.deepEqual(opensOn(fake, "b"), []);
  assert.deepEqual(opensOn(fake, "a"), []);
  assert.equal(get(fake.projectStore).opening, null);
});

it("an open whose unsaved-work prompt answers after a switch to B never reaches B", async () => {
  const prompt = deferred();
  const fake = setup({ confirmOpen: () => prompt.promise });
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/chosen-on-a.marasi" });
  await settle();
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });
  await settle();
  fake.connectionStore.switchTo("beta");
  await settle();
  prompt.resolve(true);

  assert.deepEqual(await opening, { status: "superseded" });
  await settle();
  assert.deepEqual(opensOn(fake, "b"), []);
});

it("a stale open never reaches B when B's status fails and B never loads", async () => {
  const fake = setup();
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/chosen-on-a.marasi" });
  await settle();
  fake.connectionStore.switchTo("beta");
  await settle();
  fake.service.refuse("GET", "http://b:9000/service/status", 500);
  await settle();
  assert.equal(get(fake.connectionStore).phase, "failed");
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });

  assert.deepEqual(await opening, { status: "superseded" });
  await settle();
  assert.deepEqual(opensOn(fake, "b"), []);
});

it("a stale open goes nowhere once the switch began, though the client hasn't reached B yet", async () => {
  const betaPassword = deferred();
  const fake = setup({ password: (id) => (id === "beta" ? betaPassword.promise : `pw-${id}`) });
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/chosen-on-a.marasi" });
  await settle();
  fake.connectionStore.switchTo("beta");
  await settle();
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });

  assert.deepEqual(await opening, { status: "superseded" });
  await settle();
  assert.deepEqual(opensOn(fake, "a"), []);
  betaPassword.resolve("pw-beta");
  await settle();
  assert.deepEqual(opensOn(fake, "b"), []);
});

it("an open on one connection opens and loads the project", async () => {
  const fake = setup();
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/next.marasi" });
  await settle();
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });
  await settle();
  assert.deepEqual(opensOn(fake, "a")[0].body, { path: "/next.marasi" });
  fake.service.reply("POST", "http://a:9000/project/open", { project: "/next.marasi" });

  const result = await opening;
  assert.equal(result.status, "opened");
  assert.equal(get(fake.projectStore).loaded.path, "/next.marasi");
  assert.equal(fake.loads.at(-1).path, "/next.marasi");
});

it("a failed open's screen closes on a switch, and its Try again opens nothing on B", async () => {
  const fake = setup();
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/chosen-on-a.marasi" });
  await settle();
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });
  await settle();
  fake.service.refuse("POST", "http://a:9000/project/open", 500);
  assert.equal((await opening).status, "failed");
  assert.equal(get(fake.projectStore).shown, true);

  fake.connectionStore.switchTo("beta");
  await settle();
  assert.equal(get(fake.projectStore).opening, null);
  assert.equal(get(fake.projectStore).shown, false);
  assert.equal(await fake.projectStore.retry(), null);

  fake.service.reply("GET", "http://b:9000/service/status", statusOf("/b.marasi"));
  await settle();
  assert.equal(get(fake.projectStore).loaded.path, "/b.marasi");
  assert.deepEqual(opensOn(fake, "b"), []);
});

it("an open abandoned by a switch never keeps B from following another client's switch", async () => {
  const fake = setup();
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/a-next.marasi" });
  await settle();
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });
  await settle();
  assert.ok(fake.service.has("POST", "http://a:9000/project/open"), "A's open waits for its answer");

  fake.connectionStore.switchTo("beta");
  await settle();
  fake.service.reply("GET", "http://b:9000/service/status", statusOf("/b.marasi"));
  await settle();
  assert.equal(get(fake.projectStore).loaded.path, "/b.marasi");

  fake.emit("project.opened", { project: "/b-next.marasi" });
  await settle();
  fake.service.reply("GET", "http://b:9000/service/status", statusOf("/b-next.marasi"));
  await settle();
  assert.deepEqual(fake.follows, ["/b-next.marasi"], "the unsaved-work prompt asks about B's switch");
  assert.equal(get(fake.projectStore).loaded.path, "/b-next.marasi");
  assert.equal(fake.loads.at(-1).path, "/b-next.marasi");

  const loads = fake.loads.length;
  fake.service.reply("POST", "http://a:9000/project/open", { project: "/a-next.marasi" });
  assert.deepEqual(await opening, { status: "superseded" });
  await settle();
  assert.equal(get(fake.projectStore).loaded.path, "/b-next.marasi");
  assert.equal(fake.loads.length, loads);

  fake.emit("project.opened", { project: "/b-later.marasi" });
  await settle();
  assert.ok(fake.service.has("GET", "http://b:9000/service/status"), "B still follows after A's open ends");
});

it("the app's own open in progress isn't followed as another client's", async () => {
  const fake = setup();
  await onAlpha(fake);

  const opening = fake.projectStore.open({ path: "/a-next.marasi" });
  await settle();
  fake.service.reply("GET", "http://a:9000/checkpoint", { items: [] });
  await settle();
  fake.emit("project.opened", { project: "/a-next.marasi" });
  await settle();
  assert.equal(fake.service.has("GET", "http://a:9000/service/status"), false);

  fake.service.reply("POST", "http://a:9000/project/open", { project: "/a-next.marasi" });
  assert.equal((await opening).status, "opened");
  await settle();
  assert.deepEqual(fake.follows, []);
  assert.equal(get(fake.projectStore).loaded.path, "/a-next.marasi");
});
