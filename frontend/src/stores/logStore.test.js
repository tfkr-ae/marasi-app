import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLogStore } from "./createLogStore.js";

const log = (id, message = `line ${id}`) => ({
  id,
  timestamp: `2026-11-01T10:00:0${id}Z`,
  level: "INFO",
  message,
  context: {},
  request_id: null,
  extension_id: null,
});

// A fake /logs: `pages` are Marasi's answers in order, newest first.
function fakeApi(...pages) {
  const calls = [];
  let next = 0;
  return {
    calls,
    getLogs: async (cursor) => {
      calls.push(cursor);
      return pages[next++];
    },
  };
}

test("reload shows the instance's log, oldest first", async () => {
  const store = createLogStore(fakeApi({ items: [log(3), log(2), log(1)], next_cursor: "" }));
  await store.reload();
  assert.deepEqual(get(store).items.map((item) => item.id), [1, 2, 3]);
});

test("reload replaces the log rather than appending to it", async () => {
  const store = createLogStore(
    fakeApi({ items: [log(2), log(1)], next_cursor: "" }, { items: [log(3), log(2), log(1)], next_cursor: "" }),
  );
  await store.reload();
  await store.reload();
  assert.deepEqual(get(store).items.map((item) => item.id), [1, 2, 3]);
});

test("reload reads every page", async () => {
  const api = fakeApi({ items: [log(4), log(3)], next_cursor: "c3" }, { items: [log(2), log(1)], next_cursor: "" });
  const store = createLogStore(api);
  await store.reload();
  assert.deepEqual(api.calls, [undefined, "c3"]);
  assert.deepEqual(get(store).items.map((item) => item.id), [1, 2, 3, 4]);
});

test("a log.added event adds its line at the end", async () => {
  const store = createLogStore(fakeApi({ items: [log(1)], next_cursor: "" }));
  await store.reload();
  store.onLogAdded(log(2));
  assert.deepEqual(get(store).items.map((item) => item.id), [1, 2]);
});

test("a line already shown is not added twice", async () => {
  const store = createLogStore(fakeApi({ items: [log(1)], next_cursor: "" }));
  await store.reload();
  store.onLogAdded(log(1));
  assert.deepEqual(get(store).items.map((item) => item.id), [1]);
});

test("a line that arrives during a reload stays after it", async () => {
  let answer;
  const store = createLogStore({ getLogs: () => new Promise((resolve) => (answer = resolve)) });
  const reloading = store.reload();
  store.onLogAdded(log(3));
  answer({ items: [log(2), log(1)], next_cursor: "" });
  await reloading;
  assert.deepEqual(get(store).items.map((item) => item.id), [1, 2, 3]);
});

test("an older reload's answer doesn't replace a newer one", async () => {
  const answers = [];
  const store = createLogStore({ getLogs: () => new Promise((resolve) => answers.push(resolve)) });
  const first = store.reload();
  const second = store.reload();
  answers[1]({ items: [log(2), log(1)], next_cursor: "" });
  await second;
  answers[0]({ items: [log(1)], next_cursor: "" });
  await first;
  assert.deepEqual(get(store).items.map((item) => item.id), [1, 2]);
});

test("clear empties the log", async () => {
  const store = createLogStore(fakeApi({ items: [log(1)], next_cursor: "" }));
  await store.reload();
  store.clear();
  assert.deepEqual(get(store).items, []);
});
