// Settings → Upstream Proxy: keeping the list and selection each call
// returns, remembering checks, and the not-configured warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  createUpstreamProxyStore,
  selectionWarning,
  upstreamAddress,
} from "./createUpstreamProxyStore.js";

const corp = {
  name: "corp",
  scheme: "http",
  host: "10.0.0.1",
  port: 3128,
  has_credentials: true,
  has_ca: false,
};

function setup(overrides = {}) {
  const calls = [];
  const state = (items, selected = "", configured = true) => ({
    items,
    selected,
    configured,
  });
  const api = {
    list: async () => (calls.push(["list"]), state([corp], "corp")),
    add: async (...args) => (calls.push(["add", ...args]), state([corp])),
    update: async (...args) => (calls.push(["update", ...args]), state([corp])),
    remove: async (name) => (
      calls.push(["remove", name]), state([], "corp", false)
    ),
    use: async (name) => (calls.push(["use", name]), state([corp], name)),
    check: async (name, target) => (
      calls.push(["check", name, target]),
      { name, target: "example.com:443", outcome: "ok", message: "connected" }
    ),
    ...overrides,
  };
  return { store: createUpstreamProxyStore(api), calls };
}

test("load keeps the list and the selection", async () => {
  const { store } = setup();
  await store.load();
  const state = get(store);
  assert.deepEqual(state.items, [corp]);
  assert.equal(state.selected, "corp");
  assert.equal(state.loaded, true);
});

test("add sends no CA unless one is given", async () => {
  const { store, calls } = setup();
  await store.add("corp", "http://10.0.0.1:3128");
  assert.deepEqual(calls, [["add", "corp", "http://10.0.0.1:3128", ""]]);
});

test("add passes the CA it is given", async () => {
  const { store, calls } = setup();
  await store.add("corp", "https://10.0.0.1:3128", "PEM");
  assert.deepEqual(calls, [["add", "corp", "https://10.0.0.1:3128", "PEM"]]);
});

test("use keeps the new selection", async () => {
  const { store } = setup();
  await store.use("corp");
  assert.equal(get(store).selected, "corp");
});

test("a failed call leaves the state and rejects", async () => {
  const { store } = setup({
    add: async () => {
      throw new Error("upstream proxy already exists: corp");
    },
  });
  await store.load();
  await assert.rejects(
    store.add("corp", "http://10.0.0.1:3128"),
    /already exists/,
  );
  assert.deepEqual(get(store).items, [corp]);
});

test("check keeps each entry's result and clears checking", async () => {
  const { store, calls } = setup();
  const pending = store.check("corp", "https://example.com");
  assert.equal(get(store).checking, "corp");
  await pending;
  assert.equal(get(store).checking, "");
  assert.equal(get(store).checks.corp.outcome, "ok");
  assert.deepEqual(calls, [["check", "corp", "https://example.com"]]);
});

test("a check that cannot run is kept as an error result", async () => {
  const { store } = setup({
    check: async () => {
      throw "invalid check target: the target must be an http or https URL";
    },
  });
  const result = await store.check("corp", "ftp://x");
  assert.equal(result.outcome, "error");
  assert.match(get(store).checks.corp.message, /invalid check target/);
});

test("update and remove forget the entry's last check", async () => {
  const { store } = setup();
  await store.check("corp", "https://example.com");
  await store.update("corp", "http://10.0.0.2:3128", "", false);
  assert.equal(get(store).checks.corp, undefined);
  await store.check("corp", "https://example.com");
  await store.remove("corp");
  assert.equal(get(store).checks.corp, undefined);
});

test("a removed selection shows the not-configured warning", async () => {
  const { store } = setup();
  await store.remove("corp");
  assert.match(
    selectionWarning(get(store)),
    /"corp" isn't set up on this machine/,
  );
});

test("no warning for direct or a listed selection", () => {
  assert.equal(selectionWarning({ selected: "", configured: true }), "");
  assert.equal(selectionWarning({ selected: "corp", configured: true }), "");
});

test("upstreamAddress shows scheme://host:port, or nothing for a broken URL", () => {
  assert.equal(upstreamAddress(corp), "http://10.0.0.1:3128");
  assert.equal(
    upstreamAddress({ name: "broken", scheme: "", host: "", port: 0 }),
    "",
  );
});

// Another client's edits arrive as upstream_proxy.* events, applied without
// reading the list again.
test("another client's list edit replaces the list, keeping unchanged entries' checks", async () => {
  const { store, calls } = setup();
  await store.load();
  await store.check("corp", "https://example.com");
  const burp = { ...corp, name: "burp", host: "127.0.0.1", port: 8080 };

  store.onListChanged({ items: [corp, burp] });
  let state = get(store);
  assert.deepEqual(state.items, [corp, burp]);
  assert.equal(state.checks.corp.outcome, "ok", "corp didn't change");
  assert.equal(state.configured, true);

  store.onListChanged({ items: [{ ...corp, port: 3129 }, burp] });
  assert.equal(get(store).checks.corp, undefined, "a changed entry's check says nothing about it");

  store.onListChanged({ items: [burp] });
  state = get(store);
  assert.equal(state.configured, false, "the selection is no longer listed");
  assert.match(selectionWarning(state), /"corp" isn't set up/);
  assert.deepEqual(calls.filter(([name]) => name === "list"), [["list"]], "no read again");
});

test("another client's selection shows, and is checked against the list", async () => {
  const { store } = setup();
  await store.load();
  store.onSelected({ name: "" });
  assert.equal(get(store).selected, "");
  assert.equal(get(store).configured, true);
  store.onSelected({ name: "missing" });
  assert.equal(get(store).selected, "missing");
  assert.equal(get(store).configured, false);
});

test("events before Settings reads the list leave it unread", () => {
  const { store } = setup();
  store.onListChanged({ items: [corp] });
  store.onSelected({ name: "corp" });
  assert.equal(get(store).loaded, false);
  assert.deepEqual(get(store).items, []);
});

test("a load the project switch superseded changes nothing when its answer comes late", async () => {
  let answer;
  const answers = [
    new Promise((resolve) => (answer = resolve)),
    Promise.resolve({ items: [corp], selected: "", configured: true }),
  ];
  const { store } = setup({ list: () => answers.shift() });
  const superseded = store.load();
  store.clear();
  await store.load();
  answer({ items: [corp], selected: "corp", configured: true });
  await superseded;
  assert.equal(get(store).selected, "");
});
