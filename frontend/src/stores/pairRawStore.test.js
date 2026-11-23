// The raw messages of the pairs on cards, read through createToolTrafficApi
// over a fake service client and cached by createPairRawStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { fakeServiceClient } from "./fakeServiceClient.js";
import { createToolTrafficApi } from "./toolTrafficApi.js";
import { createPairRawStore } from "./createPairRawStore.js";
import { cardContent } from "../lib/tools/cardContent.js";

const b64 = (text) => Buffer.from(text).toString("base64");

// The service's pairs by id, as GET /traffic/{id} answers (raw as base64).
function rawService(pairs) {
  const routes = {};
  for (const [id, { request, response }] of Object.entries(pairs)) {
    routes[`GET /traffic/${id}`] = () => ({
      id,
      request: { raw: b64(pairs[id].request ?? request) },
      response: pairs[id].response == null ? null : { raw: b64(pairs[id].response ?? response) },
    });
  }
  const client = fakeServiceClient(routes);
  const reads = () => client.calls.map((call) => `${call.path} ${JSON.stringify(call.query)}`);
  return { client, reads, pairs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(pairs) {
  const service = rawService(pairs);
  const store = createPairRawStore(createToolTrafficApi(service.client));
  return { service, store };
}

test("a card's pair is read once, raw only, and kept by id", async () => {
  const { service, store } = setup({ a: { request: "GET / HTTP/1.1\r\n\r\n", response: "HTTP/1.1 200 OK\r\n\r\n" } });
  store.need("a", { StatusCode: 200 });
  store.need("a", { StatusCode: 200 });
  await settle();
  assert.deepEqual(service.reads(), ['/traffic/a {"prettified":false}']);
  assert.deepEqual(get(store).a, { Request: "GET / HTTP/1.1\n\n", Response: "HTTP/1.1 200 OK\n\n" });
  store.need("a", { StatusCode: 200 });
  await settle();
  assert.equal(service.reads().length, 1, "a cached pair is not read again");
});

test("a pending pair is read again once its row shows a response", async () => {
  const { service, store } = setup({ a: { request: "GET / HTTP/1.1\n\n", response: null } });
  store.need("a", { StatusCode: 0 });
  await settle();
  assert.equal(get(store).a.Response, "");
  store.need("a", { StatusCode: 0 });
  await settle();
  assert.equal(service.reads().length, 1);

  service.pairs.a.response = "HTTP/1.1 201 Created\n\n";
  store.need("a", { StatusCode: 201 });
  await settle();
  assert.equal(service.reads().length, 2);
  assert.equal(get(store).a.Response, "HTTP/1.1 201 Created\n\n");
});

test("a response that arrives after a card is expanded appears in its details", async () => {
  // As CardView does: it asks with the row it shows, and draws cardContent
  // over what the store holds.
  const { service, store } = setup({ a: { request: "POST /login HTTP/1.1\nHost: a\n\n", response: null } });
  const source = { kind: "pair", id: "a" };
  const view = { part: "both", expanded: true };
  const pending = { ID: "a", Number: 1, Method: "POST", Path: "/login", StatusCode: 0 };
  store.need("a", pending);
  await settle();
  let details = cardContent(source, pending, { view, raw: get(store).a }).details;
  assert.equal(details[1].empty, "No response yet");

  service.pairs.a.response = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"ok":true}\n';
  const answered = { ...pending, StatusCode: 200 };
  store.need("a", answered);
  await settle();
  details = cardContent(source, answered, { view, raw: get(store).a }).details;
  assert.equal(details[1].empty, undefined);
  assert.deepEqual(
    details[1].lines.map((line) => line.text),
    ["HTTP/1.1 200 OK", "Content-Type: application/json", "", '{"ok":true}'],
  );
});

test("a pair the service no longer has reads as null", async () => {
  const { store } = setup({});
  store.need("gone", null);
  await settle();
  assert.equal(get(store).gone, null);
});

test("ensure reads every pair not yet held, for Attach", async () => {
  const { service, store } = setup({ a: { request: "A\n\n", response: "RA\n\n" }, b: { request: "B\n\n", response: null } });
  store.need("a", { StatusCode: 200 });
  await settle();
  await store.ensure(["a", "b"]);
  assert.equal(service.reads().length, 2);
  assert.equal(get(store).b.Request, "B\n\n");
});

test("changing project drops what was read, and a read under way writes nothing", async () => {
  const { service, store } = setup({ a: { request: "A\n\n", response: null } });
  store.need("a", { StatusCode: 0 });
  store.clear();
  await settle();
  assert.deepEqual(get(store), {});
  store.need("a", { StatusCode: 0 });
  await settle();
  assert.equal(service.reads().length, 2, "read afresh after the change");
  assert.equal(get(store).a.Request, "A\n\n");
});
