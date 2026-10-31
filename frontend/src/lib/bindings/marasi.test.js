import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarasiClient, isNeedsNewerMarasi, needsNewerMarasiText } from "./marasi.js";
import { codeIDs } from "../errorCodes.js";
import { pendingLaunchIDs } from "../launchPending.js";
import { incompleteJobs } from "../ledger/selectionIncomplete.js";

// A fake fetch that answers every call with `status`, `body` and
// `contentType`, and records the requests it was sent.
function fakeFetch(status, body, contentType = "application/json") {
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(status === 204 ? null : text, { status, headers: { "Content-Type": contentType } });
  };
  return { fetch, sent };
}

const rejection = (promise) =>
  promise.then(
    (value) => assert.fail(`resolved with ${JSON.stringify(value)}`),
    (err) => err,
  );

test("a call fetches the route on the connection's base URL and returns its JSON", async () => {
  const { fetch, sent } = fakeFetch(200, { status: "running", instance: "default" });
  const marasi = createMarasiClient({ baseURL: "http://127.0.0.1:50037", fetch });
  assert.deepEqual(await marasi.get("/service/status"), { status: "running", instance: "default" });
  assert.equal(sent[0].url, "http://127.0.0.1:50037/service/status");
  assert.equal(sent[0].method, "GET");
});

test("a call with a body sends it as JSON", async () => {
  const { fetch, sent } = fakeFetch(200, { id: "a" });
  const marasi = createMarasiClient({ baseURL: "http://127.0.0.1:1/", fetch });
  await marasi.post("/launchpad", { name: "x" });
  assert.equal(sent[0].url, "http://127.0.0.1:1/launchpad");
  assert.equal(sent[0].method, "POST");
  assert.equal(sent[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(sent[0].body), { name: "x" });
});

test("a call answered with no content resolves to null", async () => {
  const { fetch } = fakeFetch(204, "");
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  assert.equal(await marasi.get("/traffic/query?q=x"), null);
});

test("the client never sends a token of its own", async () => {
  const { fetch, sent } = fakeFetch(200, {});
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  await marasi.put("/notes/a", { note: "n" });
  assert.equal(
    Object.keys(sent[0].headers).some((name) => name.toLowerCase() === "authorization"),
    false,
  );
});

test("a coded refusal reads as its code to the app's code helpers", async () => {
  const { fetch } = fakeFetch(409, { error: "project_busy" });
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.post("/project/open", { name: "x" }));
  assert.deepEqual(codeIDs(error, "project_busy"), []);
  assert.equal(error.code, "project_busy");
  assert.equal(error.status, 409);
});

test("a refusal's message follows its code", async () => {
  const { fetch } = fakeFetch(400, { error: "invalid_query", message: "unexpected token", position: 3 });
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.get("/traffic?q=%3D"));
  assert.match(String(error), /invalid_query: unexpected token$/);
  assert.equal(error.body.position, 3);
});

test("a refusal that names pairs reads as the pending launch helper's ids", async () => {
  const { fetch } = fakeFetch(409, { error: "launch_pending", message: "a launch is pending", request_ids: ["a1", "b2"] });
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.post("/traffic/bulk/delete", {}));
  assert.deepEqual(pendingLaunchIDs(error), ["a1", "b2"]);
});

test("a refusal that names jobs reads as the selection helper's jobs", async () => {
  const { fetch } = fakeFetch(409, { error: "selection_incomplete", jobs: ["traffic_index", "sitemap"] });
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.post("/traffic/bulk/highlight", {}));
  assert.deepEqual(incompleteJobs(error), ["traffic_index", "sitemap"]);
});

test("a refusal that names held items reads as their ids", async () => {
  const items = [{ id: "c1", type: "request", summary: "GET /" }];
  const { fetch } = fakeFetch(409, { error: "checkpoint_items_held", message: "held", items });
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.post("/service/restart"));
  assert.deepEqual(codeIDs(error, "checkpoint_items_held"), ["c1"]);
});

test("Marasi's own not found stays a coded refusal", async () => {
  const { fetch } = fakeFetch(404, { error: "not_found" });
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.get("/traffic/0193"));
  assert.deepEqual(codeIDs(error, "not_found"), []);
  assert.equal(isNeedsNewerMarasi(error), false);
});

test("a route the instance doesn't have reads Needs a newer Marasi", async () => {
  for (const status of [404, 405]) {
    const { fetch } = fakeFetch(status, "404 page not found\n", "text/plain; charset=utf-8");
    const marasi = createMarasiClient({ baseURL: "http://h", fetch });
    const error = await rejection(marasi.get("/scope"));
    assert.ok(isNeedsNewerMarasi(error));
    assert.equal(String(error), needsNewerMarasiText);
    assert.equal(needsNewerMarasiText, "Needs a newer Marasi");
  }
});

test("a failure that isn't a refusal names its status", async () => {
  const { fetch } = fakeFetch(502, "Bad Gateway", "text/plain");
  const marasi = createMarasiClient({ baseURL: "http://h", fetch });
  const error = await rejection(marasi.get("/service/status"));
  assert.match(String(error), /502/);
  assert.equal(isNeedsNewerMarasi(error), false);
});
