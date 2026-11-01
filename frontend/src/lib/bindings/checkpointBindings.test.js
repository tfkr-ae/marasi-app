// The Checkpoint bindings: the held items in v1's shape, Intercept all,
// Forward and Drop of one item or many, and the GUI-owned parse check.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";
import { isCheckpointGone } from "../checkpointHeld.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

const b64 = (text) => Buffer.from(text).toString("base64");

beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    let answer = answers[`${method} ${path}`] ?? { body: {} };
    if (typeof answer === "function") answer = answer();
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const heldRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "request",
  raw: b64("GET / HTTP/1.1\r\nHost: x\r\n\r\n"),
  intercepted_at: "2026-11-01T10:00:00+04:00",
};
const heldMessage = {
  id: "22222222-2222-4222-8222-222222222222",
  type: "websocket",
  payload: b64("hello"),
  opcode: 1,
  direction: "outgoing",
  connection_id: "33333333-3333-4333-8333-333333333333",
  request_id: "44444444-4444-4444-8444-444444444444",
  intercepted_at: "2026-11-01T10:00:01+04:00",
};
const gone = { status: 404, body: { error: "not_found" } };

test("GetCheckpointItems lists the held items in hold order, in v1's shape", async () => {
  answers["GET /checkpoint"] = { body: { items: [heldRequest, heldMessage], intercept: false, websocket_intercept: false } };
  assert.deepEqual(await App.GetCheckpointItems(), [
    {
      ID: heldRequest.id,
      Type: "request",
      Raw: heldRequest.raw,
      Payload: null,
      Opcode: 0,
      Direction: "",
      ConnectionID: null,
      RequestID: null,
      InterceptedAt: "2026-11-01T10:00:00+04:00",
    },
    {
      ID: heldMessage.id,
      Type: "websocket",
      Raw: null,
      Payload: heldMessage.payload,
      Opcode: 1,
      Direction: "outgoing",
      ConnectionID: heldMessage.connection_id,
      RequestID: heldMessage.request_id,
      InterceptedAt: "2026-11-01T10:00:01+04:00",
    },
  ]);
});

test("GetCheckpoint reads one held item, and null once it has left", async () => {
  answers[`GET /checkpoint/${heldRequest.id}`] = { body: heldRequest };
  assert.equal((await App.GetCheckpoint(heldRequest.id)).Type, "request");
  answers[`GET /checkpoint/${heldRequest.id}`] = gone;
  assert.equal(await App.GetCheckpoint(heldRequest.id), null);
});

test("ToggleIntercept sets Intercept all to the opposite of what the instance has, and resolves the new value", async () => {
  answers["GET /checkpoint"] = { body: { items: [], intercept: true, websocket_intercept: false } };
  answers["POST /checkpoint/intercept"] = { body: { items: [], intercept: false, websocket_intercept: false } };
  assert.equal(await App.GetInterceptFlag(), true);
  assert.equal(await App.ToggleIntercept(), false);
  assert.deepEqual(sent.at(-1), { method: "POST", path: "/checkpoint/intercept", body: { intercept: false } });
});

test("SetIntercept sets Intercept all and resolves the instance's value", async () => {
  answers["POST /checkpoint/intercept"] = { body: { items: [], intercept: true, websocket_intercept: false } };
  assert.equal(await App.SetIntercept(true), true);
  assert.deepEqual(sent, [{ method: "POST", path: "/checkpoint/intercept", body: { intercept: true } }]);
});

test("ForwardCheckpoint forwards a held item as held, intercepting its response when asked", async () => {
  await App.ForwardCheckpoint(heldRequest.id, "", false);
  await App.ForwardCheckpoint(heldRequest.id, "", true);
  assert.deepEqual(sent, [
    { method: "POST", path: `/checkpoint/${heldRequest.id}/forward`, body: {} },
    { method: "POST", path: `/checkpoint/${heldRequest.id}/forward`, body: { intercept_response: true } },
  ]);
});

test("ForwardCheckpoint sends an edit as the item's raw HTTP, or as a WebSocket message's payload", async () => {
  answers[`GET /checkpoint/${heldRequest.id}`] = { body: heldRequest };
  answers[`GET /checkpoint/${heldMessage.id}`] = { body: heldMessage };
  await App.ForwardCheckpoint(heldRequest.id, "GET /é HTTP/1.1\nHost: x\n\n", true);
  await App.ForwardCheckpoint(heldMessage.id, "bye", false);
  const forwards = sent.filter(({ method }) => method === "POST");
  assert.deepEqual(forwards.map(({ body }) => body), [
    { raw: b64("GET /é HTTP/1.1\nHost: x\n\n"), intercept_response: true },
    { payload: b64("bye") },
  ]);
});

test("DropCheckpoint drops a held item", async () => {
  await App.DropCheckpoint(heldRequest.id);
  assert.deepEqual(sent, [{ method: "POST", path: `/checkpoint/${heldRequest.id}/drop`, body: {} }]);
});

test("a Forward or Drop of an item that has already left rejects as gone", async () => {
  answers[`POST /checkpoint/${heldRequest.id}/forward`] = gone;
  answers[`POST /checkpoint/${heldRequest.id}/drop`] = gone;
  answers[`GET /checkpoint/${heldRequest.id}`] = gone;
  await assert.rejects(App.ForwardCheckpoint(heldRequest.id, "", false), isCheckpointGone);
  await assert.rejects(App.ForwardCheckpoint(heldRequest.id, "GET / HTTP/1.1\n\n", false), isCheckpointGone);
  await assert.rejects(App.DropCheckpoint(heldRequest.id), isCheckpointGone);
});

test("ForwardCheckpoints forwards each item in turn, counting done, gone and failed", async () => {
  answers["POST /checkpoint/a/forward"] = { body: {} };
  answers["POST /checkpoint/b/forward"] = gone;
  answers["POST /checkpoint/c/forward"] = { status: 400, body: { error: "invalid_checkpoint_request" } };
  answers["GET /checkpoint/d"] = { body: { ...heldRequest, id: "d" } };
  answers["POST /checkpoint/d/forward"] = { body: {} };
  const realError = console.error;
  console.error = () => {};
  try {
    const result = await App.ForwardCheckpoints([
      { ID: "a", Body: "" },
      { ID: "b", Body: "" },
      { ID: "c", Body: "" },
      { ID: "d", Body: "GET /d HTTP/1.1\nHost: x\n\n" },
    ]);
    assert.deepEqual(result, { Done: 2, Gone: 1, Failed: 1 });
  } finally {
    console.error = realError;
  }
  assert.deepEqual(
    sent.filter(({ method }) => method === "POST").map(({ path, body }) => [path, body]),
    [
      ["/checkpoint/a/forward", {}],
      ["/checkpoint/b/forward", {}],
      ["/checkpoint/c/forward", {}],
      ["/checkpoint/d/forward", { raw: b64("GET /d HTTP/1.1\nHost: x\n\n") }],
    ],
  );
});

test("DropCheckpoints drops each id in turn, counting done, gone and failed", async () => {
  answers["POST /checkpoint/b/drop"] = gone;
  answers["POST /checkpoint/c/drop"] = { status: 500, body: { error: "internal_server_error" } };
  const realError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await App.DropCheckpoints(["a", "b", "c"]), { Done: 1, Gone: 1, Failed: 1 });
  } finally {
    console.error = realError;
  }
  assert.deepEqual(sent.map(({ path }) => path), ["/checkpoint/a/drop", "/checkpoint/b/drop", "/checkpoint/c/drop"]);
});

test("CheckHTTPParse answers why an edited request or response doesn't parse, without asking the instance", async () => {
  assert.equal(await App.CheckHTTPParse("GET / HTTP/1.1\nHost: x\n\n", "request"), "");
  assert.equal(await App.CheckHTTPParse("HTTP/1.1 20 OK\n\n", "response"), 'malformed HTTP status code "20"');
  assert.deepEqual(sent, []);
});
