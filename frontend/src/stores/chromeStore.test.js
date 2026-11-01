// The instance's Chrome paths and profiles, which Settings → Browser and
// Home's Chrome menu show: each call's answer, and the chrome.* events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createChromeStore } from "./createChromeStore.js";

const chromium = { OS: "darwin", Path: "/Applications/Chromium.app" };

function setup(overrides = {}) {
  const calls = [];
  const api = {
    paths: async () => [chromium],
    profiles: async () => ["work"],
    addPath: async (...args) => (calls.push(["addPath", ...args]), [chromium, { OS: "linux", Path: "/usr/bin/chromium" }]),
    removePath: async (...args) => (calls.push(["removePath", ...args]), []),
    addProfile: async (name) => (calls.push(["addProfile", name]), ["work", name]),
    removeProfile: async (name) => (calls.push(["removeProfile", name]), []),
    ...overrides,
  };
  return { store: createChromeStore(api), calls };
}

test("reload reads the paths and profiles", async () => {
  const { store } = setup();
  await store.reload();
  assert.deepEqual(get(store), { paths: [chromium], profiles: ["work"] });
});

test("each change keeps the list Marasi answers", async () => {
  const { store, calls } = setup();
  await store.addPath("/usr/bin/chromium", "linux");
  assert.equal(get(store).paths.length, 2);
  await store.removePath(chromium);
  assert.deepEqual(get(store).paths, []);
  await store.addProfile("lab");
  assert.deepEqual(get(store).profiles, ["work", "lab"]);
  await store.removeProfile("lab");
  assert.deepEqual(get(store).profiles, []);
  assert.deepEqual(calls, [
    ["addPath", "/usr/bin/chromium", "linux"],
    ["removePath", "/Applications/Chromium.app", "darwin"],
    ["addProfile", "lab"],
    ["removeProfile", "lab"],
  ]);
});

test("chrome.* events show a change the CLI or another window made", () => {
  const { store } = setup();
  store.onPaths({ items: [{ os: "linux", path: "/usr/bin/chromium" }] });
  store.onProfiles({ items: [{ name: "cli" }] });
  assert.deepEqual(get(store), { paths: [{ OS: "linux", Path: "/usr/bin/chromium" }], profiles: ["cli"] });
});

test("on a remote connection Chrome is this machine's, so the instance's chrome.* events are ignored", async () => {
  const { store } = setup({ instanceChrome: () => false });
  await store.reload();
  store.onPaths({ items: [{ os: "linux", path: "/remote/chromium" }] });
  store.onProfiles({ items: [{ name: "remote" }] });
  assert.deepEqual(get(store), { paths: [chromium], profiles: ["work"] });
});
