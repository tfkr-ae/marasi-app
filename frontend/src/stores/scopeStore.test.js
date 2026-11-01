// Compass's scope rules: read from the instance, and read again when
// Compass's code changes, as Marasi announces no scope event of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createScopeStore } from "./createScopeStore.js";

const rules = {
  defaultAllow: false,
  includeRules: [{ pattern: "example\\.com", matchType: "host" }],
  excludeRules: [{ pattern: "\\.png$", matchType: "path" }],
};

function setup(answers = [rules]) {
  let reads = 0;
  const api = { getRules: async () => answers[Math.min(reads++, answers.length - 1)] };
  return { store: createScopeStore(api), reads: () => reads };
}

test("before a read the scope is not loaded", () => {
  const { store } = setup();
  assert.deepEqual(get(store), { loaded: false, defaultAllow: false, includeRules: [], excludeRules: [] });
});

test("reload reads the rules", async () => {
  const { store } = setup();
  await store.reload();
  assert.deepEqual(get(store), { loaded: true, ...rules });
});

test("an update to Compass rereads the rules", async () => {
  const changed = { ...rules, defaultAllow: true };
  const { store, reads } = setup([rules, changed]);
  await store.reload();
  await store.onExtension({ name: "compass" });
  assert.equal(reads(), 2);
  assert.equal(get(store).defaultAllow, true);
});

test("an update to another extension leaves the rules alone", async () => {
  const { store, reads } = setup();
  await store.reload();
  await store.onExtension({ name: "workshop" });
  assert.equal(reads(), 1);
});

test("clear forgets the rules", async () => {
  const { store } = setup();
  await store.reload();
  store.clear();
  assert.equal(get(store).loaded, false);
  assert.deepEqual(get(store).includeRules, []);
});

test("a read begun before clear, as before a project switch, doesn't land after it", async () => {
  let answer;
  const store = createScopeStore({ getRules: () => new Promise((resolve) => (answer = resolve)) });
  const reading = store.reload();
  store.clear();
  answer(rules);
  await reading;
  assert.equal(get(store).loaded, false);
});
