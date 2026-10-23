import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import {
  createCheckpointStore,
  isDirty,
  parseErrorOf,
  pickedIds,
  textOf,
} from "./createCheckpointStore.js";

// Base64 of the text, as Wails sends a Go []byte.
const b64 = (text) => Buffer.from(text).toString("base64");

const request = (id, path = `/${id}`) => ({
  ID: id,
  Type: "request",
  Raw: b64(`GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`),
  InterceptedAt: "2026-10-23T10:00:00Z",
});

// An in-memory Checkpoint: `held` is the queue in hold order.
function fakeApi(held = []) {
  const calls = [];
  const api = {
    calls,
    held,
    getItems: async () => api.held.map((item) => ({ ...item })),
    getInterceptFlag: async () => false,
    toggleIntercept: async () => true,
    forward: async (id, body, interceptResponse) => {
      calls.push(["forward", id, body, interceptResponse]);
      api.held = api.held.filter((item) => item.ID !== id);
    },
    // CheckHTTPParse: an error string, empty when the text parses.
    checkParse: async (text, type) => {
      calls.push(["checkParse", text, type]);
      return text.startsWith("BROKEN") ? `malformed HTTP ${type}` : "";
    },
    // ForwardCheckpoints and DropCheckpoints: an id no longer held is gone.
    onBulk: () => {},
    forwardMany: async (items) => {
      calls.push(["forwardMany", items.map((item) => ({ ...item }))]);
      return settleMany(items.map((item) => item.ID));
    },
    dropMany: async (ids) => {
      calls.push(["dropMany", [...ids]]);
      return settleMany(ids);
    },
    drop: async (id) => {
      calls.push(["drop", id]);
      api.held = api.held.filter((item) => item.ID !== id);
    },
  };
  function settleMany(ids) {
    const held = new Set(api.held.map((item) => item.ID));
    api.held = api.held.filter((item) => !ids.includes(item.ID));
    api.onBulk();
    const done = ids.filter((id) => held.has(id)).length;
    return { Done: done, Gone: ids.length - done };
  }
  return api;
}

async function loaded(held) {
  const api = fakeApi(held);
  const store = createCheckpointStore(api);
  await store.populate();
  return { api, store };
}

const ids = (state) => state.items.map((item) => item.ID);
const callsTo = (api, name) => api.calls.filter((call) => call[0] === name);

// Marasi drops the item because its client left, then sends checkpoint-abandoned.
function abandon(api, store, id) {
  const item = api.held.find((held) => held.ID === id);
  api.held = api.held.filter((held) => held.ID !== id);
  return store.onAbandoned({ ID: id, Type: item.Type });
}

test("populate lists the held items in hold order", async () => {
  const api = fakeApi([request("a"), request("b"), request("c")]);
  const store = createCheckpointStore(api);
  await store.populate();
  assert.deepEqual(ids(get(store)), ["a", "b", "c"]);

  api.held.push(request("d"));
  await store.onIntercepted();
  assert.deepEqual(ids(get(store)), ["a", "b", "c", "d"]);
});

test("the oldest item takes the selection when nothing is selected", async () => {
  const api = fakeApi();
  const store = createCheckpointStore(api);
  await store.populate();
  assert.equal(get(store).selectedId, null);

  api.held.push(request("a"), request("b"));
  await store.onIntercepted();
  assert.equal(get(store).selectedId, "a");
});

test("a newly held item does not take the selection", async () => {
  const api = fakeApi([request("a"), request("b")]);
  const store = createCheckpointStore(api);
  await store.populate();
  store.pick("b");

  api.held.push(request("c"));
  await store.onIntercepted();
  assert.equal(get(store).selectedId, "b");
});

test("a forward moves the selection to the next item in hold order", async () => {
  const { api, store } = await loaded([request("a"), request("b"), request("c")]);
  store.pick("b");
  await store.forward("b");
  assert.deepEqual(api.calls, [["forward", "b", "", false]]);
  assert.deepEqual(ids(get(store)), ["a", "c"]);
  assert.equal(get(store).selectedId, "c");
});

test("a drop of the last item moves the selection to the previous one", async () => {
  const { api, store } = await loaded([request("a"), request("b"), request("c")]);
  store.pick("c");
  await store.drop("c");
  assert.deepEqual(api.calls, [["drop", "c"]]);
  assert.equal(get(store).selectedId, "b");

  await store.drop("b");
  await store.drop("a");
  assert.equal(get(store).selectedId, null);
});

test("forward can intercept the response, which is held under the same id", async () => {
  const { api, store } = await loaded([request("a"), request("b")]);
  api.forward = async (id, body, interceptResponse) => {
    api.calls.push(["forward", id, body, interceptResponse]);
    api.held = [...api.held.filter((item) => item.ID !== id), { ...request(id), Type: "response" }];
  };
  await store.forward("a", { interceptResponse: true });
  assert.deepEqual(api.calls, [["forward", "a", "", true]]);
  assert.deepEqual(
    get(store).items.map((item) => [item.ID, item.Type]),
    [["b", "request"], ["a", "response"]],
  );
  assert.equal(get(store).selectedId, "b");
});

test("an item's text is its held request, response or WebSocket payload", async () => {
  const { store } = await loaded([
    request("a", "/login"),
    { ID: "w", Type: "websocket", Payload: b64('{"op":"ping"}'), Direction: "client" },
  ]);
  const state = get(store);
  assert.equal(textOf(state, "a"), "GET /login HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.equal(textOf(state, "w"), '{"op":"ping"}');
});

test("edits are kept across selection changes and dropped on forward", async () => {
  const { api, store } = await loaded([request("a"), request("b"), request("c")]);
  const edited = "GET /edited HTTP/1.1\r\nHost: x\r\n\r\n";
  await store.edit("a", edited);
  store.pick("b");
  await store.onIntercepted();
  store.pick("a");

  let state = get(store);
  assert.equal(textOf(state, "a"), edited);
  assert.equal(isDirty(state, "a"), true);
  assert.equal(isDirty(state, "b"), false);

  await store.forward("a");
  assert.deepEqual(callsTo(api, "forward"), [["forward", "a", edited, false]]);
  state = get(store);
  assert.equal(isDirty(state, "a"), false);
  assert.deepEqual(state.editsById, {});
});

test("an abandoned item leaves the queue and passes the selection on", async () => {
  const { api, store } = await loaded([request("a"), request("b"), request("c")]);
  store.pick("b");
  const reports = [];
  store.onAbandon((report) => reports.push(report));

  const report = abandon(api, store, "b");
  assert.deepEqual(ids(get(store)), ["a", "c"]);
  assert.equal(get(store).selectedId, "c");
  assert.equal(report.editLost, false);
  assert.equal(report.item.ID, "b");
  assert.deepEqual(reports, [report]);
});

test("abandoning an edited item reports the edit as lost", async () => {
  const { api, store } = await loaded([request("a"), request("b")]);
  await store.edit("a", "GET /edited HTTP/1.1\r\nHost: x\r\n\r\n");
  const report = abandon(api, store, "a");
  assert.equal(report.editLost, true);
  assert.deepEqual(get(store).editsById, {});
  assert.equal(store.onAbandoned({ ID: "gone", Type: "request" }), null);
});

test("pick toggles picks and extends a range from the anchor", async () => {
  const { store } = await loaded(["a", "b", "c", "d", "e"].map((id) => request(id)));
  store.pick("b");
  assert.deepEqual(pickedIds(get(store)), []);

  store.pick("d", { toggle: true });
  assert.deepEqual(pickedIds(get(store)), ["b", "d"]);
  assert.equal(get(store).selectedId, "d");

  store.pick("b", { toggle: true });
  assert.deepEqual(pickedIds(get(store)), ["d"]);

  // The ⌘-click on b moved the anchor there.
  store.pick("a", { range: true });
  assert.deepEqual(pickedIds(get(store)), ["a", "b"]);
  assert.equal(get(store).selectedId, "a");

  // The dock lists items by host, so a range follows the order it is given.
  store.pick("e", { range: true, order: ["a", "c", "e", "b", "d"] });
  assert.deepEqual(pickedIds(get(store)), ["b", "e"]);

  store.pick("c");
  assert.deepEqual(pickedIds(get(store)), []);
  assert.equal(get(store).selectedId, "c");
});

test("picks leave with their items", async () => {
  const { api, store } = await loaded([request("a"), request("b"), request("c")]);
  store.pick("a");
  store.pick("c", { toggle: true });
  abandon(api, store, "c");
  assert.deepEqual(pickedIds(get(store)), ["a"]);
});

test("an edit that doesn't parse has a parse error and is not forwarded", async () => {
  const { api, store } = await loaded([request("a"), request("b")]);
  await store.edit("a", "BROKEN /admin");
  assert.deepEqual(api.calls, [["checkParse", "BROKEN /admin", "request"]]);
  assert.equal(parseErrorOf(get(store), "a"), "malformed HTTP request");
  assert.equal(parseErrorOf(get(store), "b"), "");

  assert.equal(await store.forward("a"), false);
  assert.deepEqual(ids(get(store)), ["a", "b"]);

  await store.edit("a", "GET /admin HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.equal(parseErrorOf(get(store), "a"), "");
  assert.equal(await store.forward("a"), true);
});

test("WebSocket payloads are not parsed", async () => {
  const { api, store } = await loaded([
    { ID: "w", Type: "websocket", Payload: b64("hi"), Direction: "server" },
  ]);
  await store.edit("w", "BROKEN");
  assert.deepEqual(api.calls, []);
  assert.equal(parseErrorOf(get(store), "w"), "");
});

test("bulk forward acts on the ids at the click, skipping parse errors and counting gone", async () => {
  const { api, store } = await loaded(["a", "b", "c", "d"].map((id) => request(id)));
  const edited = "GET /a2 HTTP/1.1\r\nHost: x\r\n\r\n";
  await store.edit("a", edited);
  await store.edit("c", "BROKEN");
  store.pick("b");
  // d's client left, and its checkpoint-abandoned event hasn't arrived.
  api.held = api.held.filter((item) => item.ID !== "d");
  // e is held while the bulk forward runs.
  api.onBulk = () => api.held.push(request("e"));

  const ids_ = ["a", "b", "c", "d"];
  const result = await store.bulk("forward", ids_);
  ids_.length = 0;

  assert.deepEqual(callsTo(api, "forwardMany"), [
    [
      "forwardMany",
      [
        { ID: "a", Body: edited },
        { ID: "b", Body: "" },
        { ID: "d", Body: "" },
      ],
    ],
  ]);
  assert.deepEqual(result, { done: 2, skipped: 1, gone: 1, text: "Forwarded 2 · 1 skipped · 1 gone" });
  assert.deepEqual(ids(get(store)), ["c", "e"]);
  assert.equal(get(store).selectedId, "c");
  assert.equal(isDirty(get(store), "c"), true);
});

test("bulk keeps skipped items picked", async () => {
  const { store } = await loaded([request("a"), request("b")]);
  await store.edit("b", "BROKEN");
  store.pick("a");
  store.pick("b", { toggle: true });
  await store.bulk("forward", pickedIds(get(store)));
  assert.deepEqual(pickedIds(get(store)), ["b"]);
});

test("bulk drop drops edits that don't parse too", async () => {
  const { api, store } = await loaded([request("a"), request("b"), request("c")]);
  await store.edit("b", "BROKEN");
  const result = await store.bulk("drop", ["a", "b"]);
  assert.deepEqual(callsTo(api, "dropMany"), [["dropMany", ["a", "b"]]]);
  assert.deepEqual(result, { done: 2, skipped: 0, gone: 0, text: "Dropped 2" });
  assert.deepEqual(ids(get(store)), ["c"]);
});

test("Intercept all reads and toggles the shared intercept flag", async () => {
  const api = fakeApi();
  let flag = true;
  api.getInterceptFlag = async () => flag;
  api.toggleIntercept = async () => (flag = !flag);
  const interceptFlag = writable(false);
  const store = createCheckpointStore(api, { interceptFlag });

  await store.populate();
  assert.equal(get(interceptFlag), true);
  assert.equal(await store.toggleIntercept(), false);
  assert.equal(get(interceptFlag), false);
});

test("clear empties the queue, the selection and the edits", async () => {
  const { store } = await loaded([request("a"), request("b")]);
  await store.edit("a", "BROKEN");
  store.pick("b", { toggle: true });
  store.clear();
  const state = get(store);
  assert.deepEqual(
    [state.items, state.selectedId, state.picked, state.editsById, state.parseErrorsById],
    [[], null, [], {}, {}],
  );
});

test("an edit back to the held text is not dirty, ignoring CRLF", async () => {
  const { store } = await loaded([request("a")]);
  await store.edit("a", "GET /a HTTP/1.1\nHost: x\n\n");
  assert.equal(isDirty(get(store), "a"), false);
});
