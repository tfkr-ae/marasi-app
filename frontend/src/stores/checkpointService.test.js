// Checkpoint over the service: createCheckpointStore driven through
// createCheckpointApi and a fake service client that holds items the way
// Marasi's /checkpoint routes do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import { serviceError } from "../lib/service/errors.js";
import { createCheckpointApi, toCheckpointItem, toSettled } from "./checkpointApi.js";
import { createCheckpointStore, isDirty, parseErrorOf, textOf } from "./createCheckpointStore.js";

const b64 = (text) => Buffer.from(text).toString("base64");
const unb64 = (data) => Buffer.from(data, "base64").toString();

const httpItem = (id, type = "request", raw = `GET /${id} HTTP/1.1\r\nHost: x\r\n\r\n`) => ({
  id,
  type,
  raw: b64(raw),
  intercepted_at: "2026-11-06T22:07:49.626213+04:00",
});

const wsItem = (id, requestId = "up1") => ({
  id,
  type: "websocket",
  payload: b64('{"op":"ping"}'),
  opcode: 1,
  direction: "client",
  connection_id: "conn1",
  request_id: requestId,
  frame_count: 1,
  compressed: false,
  metadata: {},
  intercepted_at: "2026-11-06T22:07:50+04:00",
});

// A fake client over an in-memory Checkpoint: `held` in hold order, and the
// two flags. A route on an item no longer held answers 404 not_found, as
// Marasi does; `failing` ids answer 500.
function fakeCheckpoint(held = []) {
  const state = { held, intercept: false, websocket_intercept: false, failing: new Set(), calls: [] };
  const list = () => ({ items: state.held.map((item) => ({ ...item })), intercept: state.intercept, websocket_intercept: state.websocket_intercept });
  const refuse = (method, path, status, error) => {
    throw serviceError({ method, path, status, body: { error } });
  };
  const resolve = (method, path, id) => {
    if (state.failing.has(id)) refuse(method, path, 500, "internal_server_error");
    if (!state.held.some((item) => item.id === id)) refuse(method, path, 404, "not_found");
    state.held = state.held.filter((item) => item.id !== id);
  };
  state.client = {
    get: async (path, query) => {
      state.calls.push(["GET", path, query]);
      if (path !== "/checkpoint") refuse("GET", path, 404, "not_found");
      const answer = list();
      if (query?.kind === "websocket") answer.items = answer.items.filter((item) => item.type === "websocket");
      return answer;
    },
    post: async (path, body) => {
      state.calls.push(["POST", path, body]);
      let match;
      if ((match = /^\/checkpoint\/([^/]+)\/(forward|drop)$/.exec(path))) {
        resolve("POST", path, match[1]);
        return list();
      }
      if (path === "/checkpoint/forward" || path === "/checkpoint/drop") {
        const counts = { done: 0, gone: 0, failed: 0 };
        for (const id of body.ids) {
          if (state.failing.has(id)) counts.failed++;
          else if (state.held.some((item) => item.id === id)) {
            state.held = state.held.filter((item) => item.id !== id);
            counts.done++;
          } else counts.gone++;
        }
        return counts;
      }
      if (path === "/checkpoint/intercept") {
        state.intercept = body.intercept;
        return list();
      }
      refuse("POST", path, 404, "not_found");
    },
  };
  return state;
}

async function loaded(held) {
  const marasi = fakeCheckpoint(held);
  const interceptFlag = writable(false);
  const store = createCheckpointStore(createCheckpointApi(marasi.client), { interceptFlag });
  await store.populate();
  marasi.calls.length = 0;
  return { marasi, store, interceptFlag };
}

const ids = (store) => get(store).items.map((item) => item.ID);
const posts = (marasi) => marasi.calls.filter((call) => call[0] === "POST").map(([, path, body]) => [path, body]);

test("populate lists held HTTP and WebSocket items with their text and the Intercept all flag", async () => {
  const marasi = fakeCheckpoint([httpItem("a"), wsItem("w")]);
  marasi.intercept = true;
  const interceptFlag = writable(false);
  const store = createCheckpointStore(createCheckpointApi(marasi.client), { interceptFlag });
  await store.populate();

  const [a, w] = get(store).items;
  assert.deepEqual([a.ID, a.Type, a.InterceptedAt], ["a", "request", "2026-11-06T22:07:49.626213+04:00"]);
  assert.equal(textOf(get(store), "a"), "GET /a HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.deepEqual(
    [w.Type, w.Direction, w.Opcode, w.RequestID, w.ConnectionID],
    ["websocket", "client", 1, "up1", "conn1"],
  );
  assert.equal(textOf(get(store), "w"), '{"op":"ping"}');
  assert.equal(get(interceptFlag), true);
});

test("an unedited forward sends an empty body, an edited one the edit, and a request can hold its response", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b"), httpItem("c")]);
  const edited = "GET /edited HTTP/1.1\nHost: x\n\n";
  await store.edit("b", edited);

  assert.equal(await store.forward("a"), "forwarded");
  assert.equal(await store.forward("b"), "forwarded");
  assert.equal(await store.forward("c", { interceptResponse: true }), "forwarded");
  const sent = posts(marasi);
  assert.deepEqual(sent[0], ["/checkpoint/a/forward", {}]);
  assert.equal(sent[1][0], "/checkpoint/b/forward");
  assert.equal(unb64(sent[1][1].raw), edited);
  assert.deepEqual(sent[2], ["/checkpoint/c/forward", { intercept_response: true }]);
});

test("an edited WebSocket message is forwarded as its payload", async () => {
  const { marasi, store } = await loaded([wsItem("w")]);
  await store.edit("w", '{"op":"pong"}');
  await store.forward("w");
  const [[path, body]] = posts(marasi);
  assert.equal(path, "/checkpoint/w/forward");
  assert.deepEqual(Object.keys(body), ["payload"]);
  assert.equal(unb64(body.payload), '{"op":"pong"}');
});

test("the malformed warning comes from the frontend's parse check", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("r", "response", "HTTP/1.1 200 OK\r\n\r\n")]);
  await store.edit("a", "BROKEN /admin");
  await store.edit("r", "HTTP/1.1 20 OK\n\n");
  assert.equal(parseErrorOf(get(store), "a"), 'malformed HTTP request "BROKEN /admin"');
  assert.equal(parseErrorOf(get(store), "r"), 'malformed HTTP status code "20"');
  assert.deepEqual(marasi.calls, []);
  assert.equal(await store.forward("a"), "unparsed");
});

test("a forward or drop of an item Marasi no longer holds is gone", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b")]);
  marasi.held = [];
  assert.equal(await store.forward("a"), "gone");
  assert.equal(await store.drop("b"), "gone");
  assert.deepEqual(ids(store), []);
});

test("bulk forward sends edited items one by one and the rest by id, summing the counts", async () => {
  const { marasi, store } = await loaded(["a", "b", "c", "d", "e"].map((id) => httpItem(id)));
  const edited = "GET /b2 HTTP/1.1\nHost: x\n\n";
  await store.edit("b", edited);
  await store.edit("c", "GET /c2 HTTP/1.1\nHost: x\n\n");
  await store.edit("e", "BROKEN");
  // c left before the click reached Marasi; d fails there.
  marasi.held = marasi.held.filter((item) => item.id !== "c");
  marasi.failing.add("d");

  const result = await store.bulk("forward", ["a", "b", "c", "d", "e"]);
  const sent = posts(marasi);
  assert.deepEqual(
    sent.map(([path]) => path),
    ["/checkpoint/b/forward", "/checkpoint/c/forward", "/checkpoint/forward"],
  );
  assert.equal(unb64(sent[0][1].raw), edited);
  assert.deepEqual(sent[2][1], { ids: ["a", "d"] });
  assert.deepEqual(result, { done: 2, skipped: 1, gone: 1, failed: 1, text: "Forwarded 2 · 1 skipped · 1 gone · 1 failed" });
  assert.deepEqual(ids(store), ["d", "e"]);
  assert.equal(isDirty(get(store), "e"), true);
});

test("an edited item whose forward fails is counted failed and keeps its edit", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b")]);
  await store.edit("a", "GET /a2 HTTP/1.1\nHost: x\n\n");
  marasi.failing.add("a");
  const result = await store.bulk("forward", ["a", "b"]);
  assert.deepEqual([result.done, result.failed], [1, 1]);
  assert.deepEqual(ids(store), ["a"]);
  assert.equal(isDirty(get(store), "a"), true);
});

test("bulk drop sends the ids", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b"), httpItem("c")]);
  const result = await store.bulk("drop", ["a", "b"]);
  assert.deepEqual(posts(marasi), [["/checkpoint/drop", { ids: ["a", "b"] }]]);
  assert.equal(result.text, "Dropped 2");
  assert.deepEqual(ids(store), ["c"]);
});

test("Intercept all turns the service's flag over", async () => {
  const { marasi, store, interceptFlag } = await loaded([]);
  assert.equal(await store.toggleIntercept(), true);
  assert.deepEqual(posts(marasi), [["/checkpoint/intercept", { intercept: true }]]);
  assert.equal(get(interceptFlag), true);
  assert.equal(await store.toggleIntercept(), false);
});

test("checkpoint.updated keeps Intercept all in step with other clients", async () => {
  const { store, interceptFlag } = await loaded([]);
  store.onUpdated({ intercept: true, websocket_intercept: false });
  assert.equal(get(interceptFlag), true);
});

test("an item forwarded or dropped by another client leaves the queue", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b")]);
  store.pick("a");
  marasi.held = marasi.held.filter((item) => item.id !== "a");
  await store.onSettled(toSettled({ id: "a", type: "request", request_id: null, reason: "forwarded" }));
  assert.deepEqual(ids(store), ["b"]);
  assert.equal(get(store).selectedId, "b");
});

test("an item dropped because its client left is reported, with its lost edit", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b")]);
  await store.edit("a", "GET /a2 HTTP/1.1\nHost: x\n\n");
  marasi.held = marasi.held.filter((item) => item.id !== "a");
  const settled = toSettled({ id: "a", type: "request", request_id: null, reason: "abandoned" });
  assert.deepEqual(settled, { ID: "a", Type: "request", RequestID: null, Reason: "abandoned" });
  const report = store.onAbandoned(settled);
  assert.equal(report.editLost, true);
  assert.deepEqual(ids(store), ["b"]);
});

test("a held item from the stream maps to the store's shape", () => {
  const item = toCheckpointItem(wsItem("w", "up9"));
  assert.deepEqual(
    [item.ID, item.Type, item.Payload, item.RequestID, item.FrameCount, item.InterceptedAt],
    ["w", "websocket", b64('{"op":"ping"}'), "up9", 1, "2026-11-06T22:07:50+04:00"],
  );
});

test("resync replaces the held items in place, keeping edits and the selection", async () => {
  const { marasi, store, interceptFlag } = await loaded([httpItem("a"), httpItem("b"), httpItem("c")]);
  const edited = "GET /b2 HTTP/1.1\nHost: x\n\n";
  await store.edit("b", edited);
  store.pick("b");
  // While the stream was down: a left, d was held, Intercept all turned on.
  marasi.held = [httpItem("b"), httpItem("c"), httpItem("d")];
  marasi.intercept = true;

  await store.resync();
  assert.deepEqual(ids(store), ["b", "c", "d"]);
  assert.equal(get(store).selectedId, "b");
  assert.equal(textOf(get(store), "b"), edited);
  assert.equal(get(interceptFlag), true);
});
