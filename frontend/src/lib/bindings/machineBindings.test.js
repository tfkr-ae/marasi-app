// The machine settings' ported bindings: Chrome, upstream proxies and
// waypoints. Each sends its control API route and answers in the shape v1's
// frontend reads.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";
import { isNotPorted } from "./notPorted.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

// The connected instance answers each route from `answers`, by "METHOD
// path": a body, or [status, body] for a refusal.
beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = answers[`${method} ${path}`] ?? {};
    const [status, body] = Array.isArray(answer) ? answer : [200, answer];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

const paths = { items: [{ os: "darwin", path: "/Applications/Chromium.app" }] };
const v1Paths = [{ OS: "darwin", Path: "/Applications/Chromium.app" }];

test("the Chrome path bindings answer v1's {OS, Path} list", async () => {
  answers["GET /chrome/path"] = paths;
  answers["POST /chrome/path"] = paths;
  answers["DELETE /chrome/path"] = { items: [] };
  assert.deepEqual(await App.GetChromePaths(), v1Paths);
  assert.deepEqual(await App.AddChromePath("/Applications/Chromium.app", "darwin"), v1Paths);
  assert.deepEqual(await App.DeleteChromePath("/Applications/Chromium.app", "darwin"), []);
  assert.deepEqual(sent.slice(1), [
    { method: "POST", path: "/chrome/path", body: { os: "darwin", path: "/Applications/Chromium.app" } },
    { method: "DELETE", path: "/chrome/path", body: { os: "darwin", path: "/Applications/Chromium.app" } },
  ]);
});

test("the Chrome profile bindings answer v1's list of names", async () => {
  answers["GET /chrome/profile"] = { items: [{ name: "work" }] };
  answers["POST /chrome/profile"] = { items: [{ name: "work" }, { name: "a b" }] };
  answers["DELETE /chrome/profile/a%20b"] = { items: [{ name: "work" }] };
  assert.deepEqual(await App.GetChromeProfiles(), ["work"]);
  assert.deepEqual(await App.AddChromeProfile("a b"), ["work", "a b"]);
  assert.deepEqual(await App.DeleteChromeProfile("a b"), ["work"]);
  assert.deepEqual(sent[1], { method: "POST", path: "/chrome/profile", body: { name: "a b" } });
  assert.equal(sent[2].method, "DELETE");
  assert.equal(sent[2].path, "/chrome/profile/a%20b");
});

test("StartBrowser starts the instance's Chrome on the profile, the default for none", async () => {
  answers["POST /chrome/start"] = { status: "started", profile: "" };
  await App.StartBrowser("");
  await App.StartBrowser("work");
  assert.deepEqual(sent, [
    { method: "POST", path: "/chrome/start", body: {} },
    { method: "POST", path: "/chrome/start", body: { profile: "work" } },
  ]);
});

test("StartBrowser rejects with Marasi's refusal, as when the listener is off", async () => {
  answers["POST /chrome/start"] = [409, { error: "listener_inactive", message: "the proxy listener is not running" }];
  await assert.rejects(App.StartBrowser(""), /listener_inactive/);
});

test("on a remote connection the Chrome bindings aren't ported, so the instance's Chrome never starts", async () => {
  useConnection("https://203.0.113.5:9443", { remote: true });
  for (const call of [
    () => App.StartBrowser(""),
    () => App.GetChromePaths(),
    () => App.AddChromePath("/x", "linux"),
    () => App.DeleteChromePath("/x", "linux"),
    () => App.GetChromeProfiles(),
    () => App.AddChromeProfile("p"),
    () => App.DeleteChromeProfile("p"),
  ]) {
    await assert.rejects(call(), (error) => isNotPorted(error));
  }
  assert.deepEqual(sent, []);
});

const corp = { name: "corp", scheme: "http", host: "10.0.0.1", port: 3128, has_credentials: false, has_ca: false };
const proxies = { items: [corp], selected: "corp", configured: true };

test("GetUpstreamProxies reads the machine's list and the project's selection", async () => {
  answers["GET /upstream-proxy"] = proxies;
  assert.deepEqual(await App.GetUpstreamProxies(), proxies);
});

test("AddUpstreamProxy sends the CA only when there is one", async () => {
  answers["POST /upstream-proxy"] = proxies;
  assert.deepEqual(await App.AddUpstreamProxy("corp", "http://10.0.0.1:3128", ""), proxies);
  await App.AddUpstreamProxy("tls", "https://10.0.0.2:3128", "PEM");
  assert.deepEqual(
    sent.map((s) => s.body),
    [
      { name: "corp", url: "http://10.0.0.1:3128" },
      { name: "tls", url: "https://10.0.0.2:3128", ca: "PEM" },
    ],
  );
});

test("UpdateUpstreamProxy sends what changes, and null to remove the CA", async () => {
  answers["POST /upstream-proxy/corp"] = proxies;
  await App.UpdateUpstreamProxy("corp", "http://10.0.0.9:3128", "", false);
  await App.UpdateUpstreamProxy("corp", "", "PEM", false);
  await App.UpdateUpstreamProxy("corp", "", "PEM", true);
  assert.deepEqual(
    sent.map((s) => s.body),
    [{ url: "http://10.0.0.9:3128" }, { ca: "PEM" }, { ca: null }],
  );
});

test("UpdateUpstreamProxy with nothing to change sends nothing", async () => {
  await assert.rejects(App.UpdateUpstreamProxy("corp", "", "", false), /nothing to change/);
  assert.deepEqual(sent, []);
});

test("RemoveUpstreamProxy and CheckUpstreamProxy name the entry", async () => {
  answers["DELETE /upstream-proxy/my%20proxy"] = { items: [], selected: "my proxy", configured: false };
  answers["POST /upstream-proxy/corp/check"] = { name: "corp", outcome: "ok", message: "connected" };
  assert.equal((await App.RemoveUpstreamProxy("my proxy")).configured, false);
  assert.equal((await App.CheckUpstreamProxy("corp", "example.com:443")).outcome, "ok");
  assert.deepEqual(sent[1], { method: "POST", path: "/upstream-proxy/corp/check", body: { target: "example.com:443" } });
});

test("UseUpstreamProxy selects for the project and answers the whole list, as v1", async () => {
  answers["PUT /upstream-proxy-selection"] = { selected: "corp", configured: true };
  answers["GET /upstream-proxy"] = proxies;
  assert.deepEqual(await App.UseUpstreamProxy("corp"), proxies);
  assert.deepEqual(sent[0], { method: "PUT", path: "/upstream-proxy-selection", body: { name: "corp" } });
});

test("ReadUpstreamProxyCAFile reads the file this machine's main process picks", async () => {
  globalThis.window = { marasiApp: { readCAFile: async () => "PEM" } };
  assert.equal(await App.ReadUpstreamProxyCAFile(), "PEM");
});

test("the waypoint bindings keep v1's {hostname: override} map", async () => {
  answers["GET /waypoint"] = { items: [{ hostname: "a.test", override: "127.0.0.1:8000" }] };
  assert.deepEqual(await App.GetWaypoints(), { "a.test": "127.0.0.1:8000" });
  await App.CreateWaypoint("b.test", "10.0.0.1:443");
  await App.DeleteWaypoint("a.test");
  assert.deepEqual(sent.slice(1), [
    { method: "POST", path: "/waypoint", body: { hostname: "b.test", override: "10.0.0.1:443" } },
    { method: "DELETE", path: "/waypoint", body: { hostname: "a.test" } },
  ]);
});

test("CreateWaypoint on a host that has one updates it, as v1's create or update", async () => {
  answers["POST /waypoint"] = [409, { error: "waypoint_already_exists", message: "waypoint already exists" }];
  await App.CreateWaypoint("a.test", "127.0.0.1:9000");
  assert.deepEqual(sent[1], {
    method: "POST",
    path: "/waypoint/update",
    body: { hostname: "a.test", override: "127.0.0.1:9000" },
  });
});
