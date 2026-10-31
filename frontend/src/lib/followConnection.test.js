import { test } from "node:test";
import assert from "node:assert/strict";
import { writable } from "svelte/store";
import { followConnection, reloadStores } from "./followConnection.js";
import { NotPorted } from "./bindings/notPorted.js";

// A fake startStream that records each stream and whether it stopped.
function fakeStreams() {
  const streams = [];
  return {
    streams,
    start: (url) => {
      const stream = { url, stopped: false, stop: () => (stream.stopped = true) };
      streams.push(stream);
      return stream;
    },
  };
}

const connection = (baseURL) => ({ connection: baseURL ? { instance: "default", baseURL } : null });

test("a connected window follows its instance's /events", () => {
  const store = writable(connection(null));
  const { streams, start } = fakeStreams();
  followConnection(store, start);
  assert.equal(streams.length, 0);
  store.set(connection("http://127.0.0.1:9000"));
  assert.deepEqual(streams.map((stream) => stream.url), ["http://127.0.0.1:9000/events"]);
});

test("the stream follows the connection, and stops when it ends", () => {
  const store = writable(connection("http://127.0.0.1:9000"));
  const { streams, start } = fakeStreams();
  const stop = followConnection(store, start);
  store.set(connection("http://127.0.0.1:9000"));
  assert.equal(streams.length, 1);
  store.set(connection("http://127.0.0.1:9100"));
  assert.equal(streams[0].stopped, true);
  assert.equal(streams[1].url, "http://127.0.0.1:9100/events");
  store.set(connection(null));
  assert.equal(streams[1].stopped, true);
  store.set(connection("http://127.0.0.1:9000"));
  stop();
  assert.equal(streams[2].stopped, true);
});

test("reloading the stores reloads every one, even after one fails", async () => {
  const reloaded = [];
  const errors = [];
  const stores = [
    { reload: async () => reloaded.push("ledger") },
    {
      reload: async () => {
        throw new Error("boom");
      },
    },
    {
      reload: async () => {
        throw new NotPorted("GetLaunchpads");
      },
    },
    { reload: async () => reloaded.push("log") },
  ];
  await reloadStores(stores, { error: (...args) => errors.push(args) });
  assert.deepEqual(reloaded, ["ledger", "log"]);
  // A store whose bindings aren't ported has nothing to reload.
  assert.equal(errors.length, 1);
});
