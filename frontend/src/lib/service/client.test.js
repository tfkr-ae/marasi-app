// The service client: the one module that calls the Marasi control API. It
// runs here against a fake fetch and a fake EventSource-like constructor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServiceClient } from "./client.js";
import { codeIDs } from "../errorCodes.js";
import { pendingLaunchIDs } from "../launchPending.js";
import { isCheckpointGone } from "../checkpointHeld.js";

// A fake fetch that records each request and answers from `respond`, which
// gets {method, url, headers, body} and returns {status, body, contentType}.
function fakeFetch(respond = () => ({ status: 200, body: {} })) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const request = {
      method: init.method ?? "GET",
      url: String(url),
      headers: { ...(init.headers ?? {}) },
      body: init.body,
    };
    requests.push(request);
    const answer = respond(request);
    const text =
      answer.body === undefined ? "" : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    const contentType =
      answer.contentType ?? (typeof answer.body === "string" ? "text/plain; charset=utf-8" : "application/json");
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
      text: async () => text,
      arrayBuffer: async () => (answer.bytes ?? new TextEncoder().encode(text)).buffer,
    };
  };
  return { fetch, requests };
}

// A fake EventSource-like constructor: each instance is kept in `sources`,
// and the test plays the service with emit(), open() and drop().
function fakeEventSource() {
  const sources = [];
  class FakeEventSource {
    constructor(url, options = {}) {
      this.url = url;
      this.headers = options.headers ?? {};
      this.listeners = new Map();
      this.closed = false;
      this.onopen = null;
      this.onerror = null;
      sources.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    close() {
      this.closed = true;
    }
    open() {
      this.onopen?.({ type: "open" });
    }
    emit(type, data) {
      for (const listener of this.listeners.get(type) ?? []) listener({ type, data: JSON.stringify(data) });
    }
    drop(detail = {}) {
      this.onerror?.({ type: "error", ...detail });
    }
  }
  return { EventSource: FakeEventSource, sources };
}

function setup(respond) {
  const http = fakeFetch(respond);
  const events = fakeEventSource();
  const client = createServiceClient({ fetch: http.fetch, EventSource: events.EventSource });
  return { client, http, events };
}

test("a call sends the connection's password as a bearer token", async () => {
  const { client, http } = setup(() => ({ status: 200, body: { pairs: 3 } }));
  client.use({ url: "http://127.0.0.1:51391", password: "s3cret" });

  const dashboard = await client.get("/dashboard");

  assert.deepEqual(dashboard, { pairs: 3 });
  assert.equal(http.requests[0].url, "http://127.0.0.1:51391/dashboard");
  assert.equal(http.requests[0].headers.Authorization, "Bearer s3cret");
});

test("a connection with no password sends no Authorization header", async () => {
  const { client, http } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "" });

  await client.get("/service/status");

  assert.equal("Authorization" in http.requests[0].headers, false);
});

// Each refusal rejects with the error the frontend's helpers already read.
async function refusal(method, path, answer) {
  const { client } = setup(() => answer);
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  return client.request(method, path).then(
    () => assert.fail(`${method} ${path} resolved`),
    (err) => err,
  );
}

test("a pending launch refusal names its pairs for launchPending", async () => {
  const err = await refusal("DELETE", "/launchpad/lp1", {
    status: 409,
    body: { error: "launch_pending", request_ids: ["p1", "p2"] },
  });
  assert.deepEqual(pendingLaunchIDs(err), ["p1", "p2"]);
  assert.equal(err.status, 409);
});

test("an incomplete selection names the jobs it waits on", async () => {
  const err = await refusal("POST", "/traffic/bulk/highlight", {
    status: 409,
    body: { error: "selection_incomplete", jobs: ["traffic_index"] },
  });
  assert.deepEqual(codeIDs(err, "selection_incomplete"), ["traffic_index"]);
});

test("a project another instance holds reads as project_locked", async () => {
  const err = await refusal("POST", "/project/open", { status: 409, body: { error: "project_already_open" } });
  assert.deepEqual(codeIDs(err, "project_locked"), []);
});

test("a Checkpoint item already resolved reads as checkpoint_gone", async () => {
  for (const action of ["forward", "drop"]) {
    const err = await refusal("POST", `/checkpoint/c1/${action}`, { status: 404, body: { error: "not_found" } });
    assert.equal(isCheckpointGone(err), true, action);
    assert.deepEqual(codeIDs(err, "checkpoint_gone"), ["c1"]);
  }
  const other = await refusal("GET", "/traffic/t1", { status: 404, body: { error: "not_found" } });
  assert.equal(isCheckpointGone(other), false);
});

test("unlinking an entry no longer in the launchpad reads as not_linked", async () => {
  const err = await refusal("DELETE", "/launchpad/lp1/link/r1", { status: 404, body: { error: "not_found" } });
  assert.deepEqual(codeIDs(err, "not_linked"), []);
});

test("a refusal's message is kept as its cause", async () => {
  const err = await refusal("POST", "/listener/start", {
    status: 409,
    body: { error: "listener_unavailable", message: "address already in use" },
  });
  assert.deepEqual(codeIDs(err, "listener_unavailable"), []);
  assert.match(String(err), /address already in use/);
});

test("a refused password is an unauthorized error with its status", async () => {
  const err = await refusal("GET", "/service/status", {
    status: 401,
    body: { error: "unauthorized", message: "send the control password as Authorization: Bearer" },
  });
  assert.equal(err.code, "unauthorized");
  assert.equal(err.status, 401);
});

test("a non-JSON refusal is a generic coded error carrying the status", async () => {
  const err = await refusal("GET", "/no-such-route", { status: 404, body: "404 page not found" });
  assert.equal(err.code, "http_error");
  assert.equal(err.status, 404);
  assert.deepEqual(codeIDs(err, "http_error"), []);
  assert.match(String(err), /404/);
});

test("an event on the stream reaches the handlers registered for its name", () => {
  const { client, events } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  const logs = [];
  const responses = [];
  client.on("log.added", (log) => logs.push(log));
  client.openEvents();
  // A store that registers after the stream opened still gets its events.
  client.on("traffic.response", (response) => responses.push(response));
  const [source] = events.sources;

  source.emit("log.added", { id: "l1", level: "INFO", message: "hello" });
  source.emit("traffic.response", { id: "t1", status_code: 200 });
  source.emit("traffic.request", { id: "t2" });

  assert.deepEqual(logs, [{ id: "l1", level: "INFO", message: "hello" }]);
  assert.deepEqual(responses, [{ id: "t1", status_code: 200 }]);
});

test("an unsubscribed handler gets no more events", () => {
  const { client, events } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  const got = [];
  const stop = client.on("log.added", (log) => got.push(log.id));
  client.openEvents();
  events.sources[0].emit("log.added", { id: "a" });
  stop();
  events.sources[0].emit("log.added", { id: "b" });
  assert.deepEqual(got, ["a"]);
});

test("a handler that throws doesn't keep the event from the others", () => {
  const { client, events } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  const got = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    client.on("log.added", () => {
      throw new Error("broken store");
    });
    client.on("log.added", (log) => got.push(log.id));
    client.openEvents();
    events.sources[0].emit("log.added", { id: "a" });
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(got, ["a"]);
});

test("the event stream is opened with the password", () => {
  const { client, events } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  client.openEvents();
  assert.equal(events.sources[0].url, "http://127.0.0.1:51391/events");
  assert.equal(events.sources[0].headers.Authorization, "Bearer pw");
});

test("a dropped stream is reported once, with the refusal's status", () => {
  const { client, events } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  const opened = [];
  const drops = [];
  client.openEvents({ onOpen: () => opened.push(true), onDrop: (drop) => drops.push(drop) });
  const [source] = events.sources;
  source.open();
  source.drop({ status: 401 });
  source.drop();

  assert.deepEqual(opened, [true]);
  assert.deepEqual(drops, [{ status: 401 }]);
  assert.equal(source.closed, true);
});

test("closing the stream on purpose reports no drop", () => {
  const { client, events } = setup();
  client.use({ url: "http://127.0.0.1:51391", password: "pw" });
  const drops = [];
  client.openEvents({ onDrop: (drop) => drops.push(drop) });
  client.closeEvents();
  events.sources[0].drop();
  assert.deepEqual(drops, []);
  assert.equal(events.sources[0].closed, true);
});

test("raw bytes go as the body with their own content type", async () => {
  const { client, http } = setup(() => ({ status: 200, body: { id: "a1" } }));
  client.use({ url: "http://127.0.0.1:9", password: "pw" });
  const bytes = new Uint8Array([1, 2, 3]);

  const answer = await client.request("POST", "/finding/f1/artifact", {
    query: { filename: "shot.png" },
    raw: bytes,
    contentType: "image/png",
  });

  assert.deepEqual(answer, { id: "a1" });
  const sent = http.requests[0];
  assert.equal(sent.url, "http://127.0.0.1:9/finding/f1/artifact?filename=shot.png");
  assert.equal(sent.body, bytes);
  assert.equal(sent.headers["Content-Type"], "image/png");
  assert.equal(sent.headers.Authorization, "Bearer pw");
});

test("an answer read as bytes resolves to the raw bytes", async () => {
  const { client } = setup(() => ({ status: 200, contentType: "application/octet-stream", body: "", bytes: new Uint8Array([0, 255, 7]) }));
  client.use({ url: "http://127.0.0.1:9" });

  const bytes = await client.request("GET", "/artifact/a1/content", { as: "bytes" });

  assert.deepEqual([...bytes], [0, 255, 7]);
});

test("a refusal of a bytes call is still a coded error", async () => {
  const { client } = setup(() => ({ status: 400, body: { error: "invalid_report_request", message: "bad template" } }));
  client.use({ url: "http://127.0.0.1:9" });

  await assert.rejects(client.request("POST", "/report", { body: {}, as: "bytes" }), (err) => {
    assert.match(String(err), /invalid_report_request/);
    return true;
  });
});
