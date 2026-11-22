// Checkpoint over the service: createCheckpointStore driven through
// createCheckpointApi and a fake service client that holds items the way
// Marasi's /checkpoint routes do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import { serviceError, superseded } from "../lib/service/errors.js";
import { createCheckpointApi, toCheckpointItem, toSettled } from "./checkpointApi.js";
import { createCheckpointStore, isDirty, parseErrorOf, refusalOf, textOf } from "./createCheckpointStore.js";

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
  const state = { held, intercept: false, websocket_intercept: false, stream_intercept: false, failing: new Set(), calls: [] };
  const list = () => ({
    items: state.held.map((item) => ({ ...item })),
    intercept: state.intercept,
    websocket_intercept: state.websocket_intercept,
    stream_intercept: state.stream_intercept,
  });
  const refuse = (method, path, status, error, message) => {
    throw serviceError({ method, path, status, body: message ? { error, message } : { error } });
  };
  // `refusing` maps an id to the reason Marasi refuses its edit with.
  state.refusing = {};
  const resolve = (method, path, id) => {
    if (state.failing.has(id)) refuse(method, path, 500, "internal_server_error");
    if (state.refusing[id]) refuse(method, path, 400, "invalid_checkpoint_request", state.refusing[id]);
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
      if (path === "/checkpoint/stream-intercept") {
        state.stream_intercept = body.stream_intercept;
        return list();
      }
      refuse("POST", path, 404, "not_found");
    },
  };
  // bind() as the service client's: bound calls made after leave() are
  // superseded, unsent. `afterPost(path)` runs after each answered POST.
  state.generation = 0;
  state.leave = () => state.generation++;
  state.afterPost = () => {};
  const post = state.client.post;
  state.client.post = async (path, body) => {
    const answer = await post(path, body);
    state.afterPost(path);
    return answer;
  };
  state.client.bind = () => {
    const at = state.generation;
    const live = () => at === state.generation;
    return {
      live,
      get: (path, query) => (live() ? state.client.get(path, query) : Promise.reject(superseded("GET", path))),
      post: (path, body) => (live() ? state.client.post(path, body) : Promise.reject(superseded("POST", path))),
    };
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
  assert.equal(parseErrorOf(get(store), "a"), "reading the edited request head: EOF");
  assert.equal(
    parseErrorOf(get(store), "r"),
    'reading the edited response head: parsing status line "HTTP/1.1 20 OK": malformed message head',
  );
  assert.deepEqual(marasi.calls, []);
  assert.equal(await store.forward("a"), "unparsed");
});

const h2Request = (id) => httpItem(id, "request", `GET /${id} HTTP/2\r\n:authority: x\r\n\r\n`);

test("an HTTP/2 item's edit is checked in Marasi's HTTP/2 text form", async () => {
  const { marasi, store } = await loaded([h2Request("a"), h2Request("b"), httpItem("r", "response", "HTTP/2 200\r\n\r\n")]);
  assert.deepEqual(get(store).items.map((item) => item.protocol), ["h2", "h2", "h2"]);
  await store.edit("a", "POST /a HTTP/2\r\n:authority: x\r\ncontent-type: text/plain\r\n\r\nhi");
  await store.edit("b", "GET /b HTTP/1.1\r\nHost: x\r\n\r\n");
  await store.edit("r", "HTTP/2 404\r\nbroken\r\n\r\n");
  assert.equal(parseErrorOf(get(store), "a"), "");
  assert.equal(
    parseErrorOf(get(store), "b"),
    'not an HTTP/2 message in the text form: the request line "GET /b HTTP/1.1" is not METHOD target HTTP/2',
  );
  assert.equal(
    parseErrorOf(get(store), "r"),
    'not an HTTP/2 message in the text form: the field line "broken" has no colon',
  );
  assert.deepEqual(marasi.calls, []);
});

test("bulk forward sends a valid HTTP/2 edit and skips a broken one", async () => {
  const { marasi, store } = await loaded([h2Request("a"), h2Request("b")]);
  const edited = "GET /edited HTTP/2\n:authority: x\n\n";
  await store.edit("a", edited);
  await store.edit("b", "GET /b HTTP/2.0\n\n");
  const result = await store.bulk("forward", ["a", "b"]);
  assert.deepEqual([result.done, result.skipped], [1, 1]);
  const [[path, body]] = posts(marasi);
  assert.equal(path, "/checkpoint/a/forward");
  assert.equal(unb64(body.raw), edited);
  assert.deepEqual(ids(store), ["b"]);
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

test("bulk forward stops at the item a connection switch overtook, sending the rest nowhere", async () => {
  const { marasi, store } = await loaded([httpItem("a"), httpItem("b"), httpItem("c")]);
  await store.edit("a", "GET /a2 HTTP/1.1\nHost: x\n\n");
  await store.edit("b", "GET /b2 HTTP/1.1\nHost: x\n\n");
  marasi.afterPost = (path) => path === "/checkpoint/a/forward" && marasi.leave();

  const result = await store.bulk("forward", ["a", "b", "c"]);

  assert.deepEqual(
    posts(marasi).map(([path]) => path),
    ["/checkpoint/a/forward"],
  );
  assert.equal(result.done, 1);
  assert.equal(result.failed, 0);
});

// Stream messages and trailer blocks, as GET /checkpoint lists them.
const PROTO_TEXT = '1:VARINT 1\n3:LEN {"hi"}';
const streamItem = (id, { text = PROTO_TEXT, payload = b64("\x08\x01\x1a\x02hi"), framing = "grpc", direction = "request" } = {}) => ({
  id,
  type: "stream",
  payload,
  text,
  direction,
  framing,
  pair_id: "pair1",
  flags: 0,
  compressed: false,
  metadata: {},
  intercepted_at: "2026-11-22T10:00:00Z",
});
const trailerItem = (id, raw = "grpc-status: 0\r\ngrpc-message: ok\r\n") => ({
  id,
  type: "trailer",
  raw: b64(raw),
  direction: "response",
  framing: "grpc",
  pair_id: "pair1",
  metadata: {},
  intercepted_at: "2026-11-22T10:00:01Z",
});

test("held stream messages and trailer blocks list in hold order with their text", async () => {
  const sse = streamItem("e", { text: null, payload: b64("data: tick\n\n"), framing: "sse", direction: "response" });
  const binary = streamItem("x", { text: null, payload: Buffer.from([0, 0xff, 1]).toString("base64") });
  const { store } = await loaded([httpItem("a"), streamItem("s"), trailerItem("t"), sse, binary]);
  const state = get(store);
  assert.deepEqual(ids(store), ["a", "s", "t", "e", "x"]);
  const [, s, t, e, x] = state.items;
  assert.deepEqual(
    [s.Type, s.PairID, s.Direction, s.Framing, s.Flags, s.Compressed],
    ["stream", "pair1", "request", "grpc", 0, false],
  );
  assert.deepEqual([t.Type, t.PairID, t.Direction, t.Framing], ["trailer", "pair1", "response", "grpc"]);
  assert.equal(textOf(state, "s"), PROTO_TEXT);
  assert.deepEqual([s.textForm, s.editable], [true, true]);
  assert.equal(textOf(state, "t"), "grpc-status: 0\r\ngrpc-message: ok\r\n");
  assert.equal(textOf(state, "e"), "data: tick\n\n");
  assert.deepEqual([e.textForm, e.editable], [false, true]);
  assert.equal(textOf(state, "x"), "00 ff 01");
  assert.equal(x.editable, false);
});

test("a stream message forwards an edited text form as text, else as payload; a trailer block as raw", async () => {
  const sse = streamItem("e", { text: null, payload: b64("data: tick\n\n"), framing: "sse", direction: "response" });
  const { marasi, store } = await loaded([streamItem("s"), sse, trailerItem("t"), streamItem("u")]);
  const edited = "1:VARINT 7\n3:LEN {\"EDITED\"}";
  await store.edit("s", edited);
  await store.edit("e", "data: tock\n\n");
  await store.edit("t", "grpc-status: 5\ngrpc-message: rewritten\n");
  assert.equal(parseErrorOf(get(store), "s"), "");

  for (const id of ["s", "e", "t", "u"]) assert.equal(await store.forward(id), "forwarded");
  const sent = posts(marasi);
  assert.deepEqual(sent[0], ["/checkpoint/s/forward", { text: edited }]);
  assert.deepEqual(Object.keys(sent[1][1]), ["payload"]);
  assert.equal(unb64(sent[1][1].payload), "data: tock\n\n");
  assert.deepEqual(Object.keys(sent[2][1]), ["raw"]);
  assert.equal(unb64(sent[2][1].raw), "grpc-status: 5\ngrpc-message: rewritten\n");
  assert.deepEqual(sent[3], ["/checkpoint/u/forward", {}]);
  assert.deepEqual(ids(store), []);
});

test("a refused edit stays held with Marasi's reason and its line and column, until it is edited again", async () => {
  const { marasi, store } = await loaded([streamItem("s"), trailerItem("t")]);
  await store.edit("s", "1:VARINT 7\n3:LEN {\"oops");
  marasi.refusing.s = "s: the text form cannot be encoded: line 2 column 8: unterminated string: text form syntax error";

  assert.equal(await store.forward("s"), "refused");
  assert.deepEqual(ids(store), ["s", "t"]);
  assert.deepEqual(refusalOf(get(store), "s"), {
    message: "the text form cannot be encoded: line 2 column 8: unterminated string: text form syntax error",
    line: 2,
    column: 8,
  });
  assert.equal(isDirty(get(store), "s"), true);

  await store.edit("s", "1:VARINT 7");
  assert.equal(refusalOf(get(store), "s"), null);

  marasi.refusing.t = "t: the trailer block does not parse: \"oops\" is not a \"name: value\" line";
  await store.edit("t", "oops");
  assert.equal(await store.forward("t"), "refused");
  assert.deepEqual(refusalOf(get(store), "t"), {
    message: "the trailer block does not parse: \"oops\" is not a \"name: value\" line",
    line: 0,
    column: 0,
  });
});

test("a stream message and a trailer block drop; a drop the direction can't carry stays held", async () => {
  const { marasi, store } = await loaded([streamItem("s"), trailerItem("t"), streamItem("n")]);
  marasi.refusing.n = "n: the direction's head declares a length: the request head declares a length, so a drop cannot be carried";
  assert.equal(await store.drop("s"), "dropped");
  assert.equal(await store.drop("t"), "dropped");
  assert.equal(await store.drop("n"), "refused");
  assert.deepEqual(posts(marasi), [
    ["/checkpoint/s/drop", {}],
    ["/checkpoint/t/drop", {}],
    ["/checkpoint/n/drop", {}],
  ]);
  assert.deepEqual(ids(store), ["n"]);
  assert.match(refusalOf(get(store), "n").message, /^the direction.s head declares a length/);
});

test("Stream intercept comes from the list and checkpoint.updated, and turns over on the service", async () => {
  const marasi = fakeCheckpoint([]);
  marasi.stream_intercept = true;
  const store = createCheckpointStore(createCheckpointApi(marasi.client));
  await store.populate();
  assert.equal(get(store).streamIntercept, true);

  assert.equal(await store.toggleStreamIntercept(), false);
  assert.deepEqual(posts(marasi), [["/checkpoint/stream-intercept", { stream_intercept: false }]]);
  assert.equal(get(store).streamIntercept, false);

  store.onUpdated({ intercept: false, websocket_intercept: false, stream_intercept: true });
  assert.equal(get(store).streamIntercept, true);
  // An older service sends no stream_intercept: the switch stays as it was.
  store.onUpdated({ intercept: true });
  assert.equal(get(store).streamIntercept, true);
});

test("bulk Forward and Drop cover stream messages and trailer blocks with every other kind", async () => {
  const held = () => [httpItem("a"), wsItem("w"), streamItem("s"), trailerItem("t"), streamItem("u")];
  const { marasi, store } = await loaded(held());
  await store.edit("s", "1:VARINT 9");
  await store.edit("t", "grpc-status: 5\n");
  const result = await store.bulk("forward", ["a", "w", "s", "t", "u"]);
  const sent = posts(marasi);
  assert.deepEqual(sent[0], ["/checkpoint/s/forward", { text: "1:VARINT 9" }]);
  assert.equal(sent[1][0], "/checkpoint/t/forward");
  assert.equal(unb64(sent[1][1].raw), "grpc-status: 5\n");
  assert.deepEqual(sent[2], ["/checkpoint/forward", { ids: ["a", "w", "u"] }]);
  assert.equal(result.text, "Forwarded 5");
  assert.deepEqual(ids(store), []);

  marasi.held = held();
  await store.populate();
  marasi.calls.length = 0;
  assert.equal((await store.bulk("drop", ["a", "w", "s", "t", "u"])).text, "Dropped 5");
  assert.deepEqual(posts(marasi), [["/checkpoint/drop", { ids: ["a", "w", "s", "t", "u"] }]]);
});
