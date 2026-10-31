// Home's ported bindings: the listener, the interface picker, the dashboard
// counts, the background jobs and the certificate. Each sends its control API
// route and answers in the shape v1's frontend reads.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

// The connected instance answers each route from `answers`, by "METHOD path".
beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const body = answers[`${method} ${path}`] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

test("StartProxy and UpdateProxy send the address and a numeric port", async () => {
  await App.StartProxy("0.0.0.0", "8080");
  await App.UpdateProxy("127.0.0.1", "9090");
  await App.StopProxy();
  assert.deepEqual(sent, [
    { method: "POST", path: "/listener/start", body: { address: "0.0.0.0", port: 8080 } },
    { method: "POST", path: "/listener/update", body: { address: "127.0.0.1", port: 9090 } },
    { method: "POST", path: "/listener/stop", body: undefined },
  ]);
});

test("GetInterfaces lists the instance machine's addresses", async () => {
  const items = [
    { address: "127.0.0.1", family: "ipv4", interface: "lo0" },
    { address: "::1", family: "ipv6", interface: "lo0" },
  ];
  answers["GET /listener/interfaces"] = { items };
  assert.deepEqual(await App.GetInterfaces(), items);
});

test("CountNotes reads the dashboard counts in v1's shape", async () => {
  answers["GET /dashboard"] = { pairs: 120, notes: 4, launchpads: 2, intercepted: 7, intercepted_count: { complete: false } };
  assert.deepEqual(await App.CountNotes(), {
    Requests: 120,
    Notes: 4,
    Launchpads: 2,
    Interceptions: 7,
    InterceptionsComplete: false,
  });
});

test("ListJobs reads the jobs in v1's shape, with the ones Maintenance can rebuild", async () => {
  answers["GET /jobs"] = {
    items: [
      { name: "traffic_index", complete: false, done: 3, total: 10 },
      { name: "prettified_move", complete: true, done: 0, total: 0 },
    ],
  };
  assert.deepEqual(await App.ListJobs(), [
    { Name: "traffic_index", Complete: false, Done: 3, Total: 10, Rebuildable: true },
    { Name: "prettified_move", Complete: true, Done: 0, Total: 0, Rebuildable: false },
  ]);
});

test("RebuildJob asks Marasi to rebuild the named job", async () => {
  await App.RebuildJob("sitemap");
  assert.deepEqual(sent, [{ method: "POST", path: "/jobs/sitemap/rebuild", body: undefined }]);
});

test("DownloadCert saves the instance's CA certificate on this machine", async () => {
  answers["GET /certificate"] = { pem: "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n" };
  const saved = [];
  globalThis.window = { marasiApp: { saveCertificate: async (pem) => (saved.push(pem), "/tmp/marasi-proxy.crt") } };
  assert.equal(await App.DownloadCert(), true);
  assert.deepEqual(saved, ["-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n"]);
});

test("DownloadCert reports a cancelled save as not saved", async () => {
  answers["GET /certificate"] = { pem: "pem" };
  globalThis.window = { marasiApp: { saveCertificate: async () => "" } };
  assert.equal(await App.DownloadCert(), false);
});

test("CopyCertToClipboard copies the certificate to this machine's clipboard", async () => {
  answers["GET /certificate"] = { pem: "pem text" };
  const copied = [];
  globalThis.window = { marasiApp: { copyText: async (text) => copied.push(text) } };
  assert.equal(await App.CopyCertToClipboard(), true);
  assert.deepEqual(copied, ["pem text"]);
});
