// Settings → Upstream Proxy over the service: createUpstreamProxyApi (over a
// fake service client) feeding createUpstreamProxyStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createUpstreamProxyApi } from "./upstreamProxyApi.js";
import { createUpstreamProxyStore } from "./createUpstreamProxyStore.js";

const corp = { name: "corp", scheme: "http", host: "10.0.0.1", port: 3128, has_credentials: true, has_ca: false };
const burp = { name: "burp", scheme: "http", host: "127.0.0.1", port: 8080, has_credentials: false, has_ca: true };

// A fake service client: `routes` maps "METHOD path" to a body or a function
// of the request body; each call is recorded as [method, path, body].
function fakeClient(routes) {
  const calls = [];
  const call = (method) => async (path, body) => {
    calls.push(body === undefined ? [method, path] : [method, path, body]);
    const answer = routes[`${method} ${path}`];
    if (answer === undefined) throw new Error(`${method} ${path}: not_found: HTTP 404`);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(body) : answer;
  };
  return { calls, get: call("GET"), post: call("POST"), put: call("PUT"), del: call("DELETE") };
}

function setup(routes) {
  const client = fakeClient({
    "GET /upstream-proxy": { items: [corp], selected: "corp", configured: true },
    ...routes,
  });
  const store = createUpstreamProxyStore(createUpstreamProxyApi(client));
  return { client, store };
}

test("load shows the service's list and the project's selection", async () => {
  const { store } = setup();
  await store.load();
  const state = get(store);
  assert.deepEqual(state.items, [corp]);
  assert.equal(state.selected, "corp");
  assert.equal(state.configured, true);
});

test("add sends the CA only when there is one, and keeps the selection", async () => {
  const { client, store } = setup({
    "POST /upstream-proxy": { items: [corp, burp] },
    "GET /upstream-proxy": { items: [corp, burp], selected: "corp", configured: true },
  });
  await store.load();
  await store.add("plain", "http://proxy.internal:3128", "");
  await store.add("burp", "http://127.0.0.1:8080", "PEM");
  const posts = client.calls.filter(([method]) => method === "POST");
  assert.deepEqual(posts, [
    ["POST", "/upstream-proxy", { name: "plain", url: "http://proxy.internal:3128" }],
    ["POST", "/upstream-proxy", { name: "burp", url: "http://127.0.0.1:8080", ca: "PEM" }],
  ]);
  const state = get(store);
  assert.deepEqual(state.items, [corp, burp]);
  assert.equal(state.selected, "corp");
});

test("update sends the URL, a new CA, or a null CA to remove it", async () => {
  const { client, store } = setup({
    "POST /upstream-proxy/burp": { items: [corp, { ...burp, has_ca: false }] },
    "GET /upstream-proxy": { items: [corp, { ...burp, has_ca: false }], selected: "corp", configured: true },
  });
  await store.update("burp", "http://127.0.0.1:9090", "", false);
  await store.update("burp", "", "PEM", false);
  await store.update("burp", "", "", true);
  const posts = client.calls.filter(([method]) => method === "POST");
  assert.deepEqual(posts, [
    ["POST", "/upstream-proxy/burp", { url: "http://127.0.0.1:9090" }],
    ["POST", "/upstream-proxy/burp", { ca: "PEM" }],
    ["POST", "/upstream-proxy/burp", { ca: null }],
  ]);
  assert.equal(get(store).items[1].has_ca, false);
});

test("an update that changes nothing is refused before the service", async () => {
  const { client, store } = setup();
  await assert.rejects(store.update("burp", "", "", false), /nothing to change/);
  assert.equal(client.calls.length, 0);
});

test("a name with a slash or space is sent escaped", async () => {
  const { client, store } = setup({ "DELETE /upstream-proxy/a%20b": { items: [corp] } });
  await store.remove("a b");
  assert.deepEqual(client.calls[0], ["DELETE", "/upstream-proxy/a%20b"]);
});

test("remove forgets the entry's check; the kept selection reads not configured", async () => {
  const { store } = setup({
    "POST /upstream-proxy/corp/check": { name: "corp", address: "10.0.0.1:3128", target: "https://example.com", outcome: "ok", message: "" },
    "DELETE /upstream-proxy/corp": { items: [] },
    "GET /upstream-proxy": { items: [], selected: "corp", configured: false },
  });
  await store.check("corp", "https://example.com");
  assert.equal(get(store).checks.corp.outcome, "ok");
  await store.remove("corp");
  const state = get(store);
  assert.deepEqual(state.items, []);
  assert.equal(state.configured, false);
  assert.equal(state.checks.corp, undefined);
});

test("use puts the selection and reads the list again", async () => {
  const { client, store } = setup({
    "PUT /upstream-proxy-selection": { selected: "", configured: true },
    "GET /upstream-proxy": { items: [corp], selected: "", configured: true },
  });
  await store.use("");
  assert.deepEqual(client.calls[0], ["PUT", "/upstream-proxy-selection", { name: "" }]);
  assert.deepEqual(client.calls[1], ["GET", "/upstream-proxy"]);
  assert.equal(get(store).selected, "");
});

test("check sends the target and keeps the outcome; a refusal is kept as its result", async () => {
  const { client, store } = setup({
    "POST /upstream-proxy/corp/check": (body) => ({ name: "corp", address: "10.0.0.1:3128", target: body.target, outcome: "refused", message: "connection refused" }),
    "POST /upstream-proxy/burp/check": new Error("POST /upstream-proxy/burp/check: invalid_target: bad"),
  });
  await store.check("corp", "https://example.com");
  assert.deepEqual(client.calls[0], ["POST", "/upstream-proxy/corp/check", { target: "https://example.com" }]);
  assert.equal(get(store).checks.corp.outcome, "refused");
  await store.check("burp", "nope");
  assert.equal(get(store).checks.burp.outcome, "error");
  assert.match(get(store).checks.burp.message, /invalid_target/);
});
