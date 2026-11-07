import { test } from "node:test";
import assert from "node:assert/strict";
import { createStartChrome, chromeErrorText } from "./startChrome.js";

// A service client that answers GET routes from a table and records calls.
function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    get: async (path) => {
      calls.push(`GET ${path}`);
      const answer = routes[path];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    post: async (path) => {
      calls.push(`POST ${path}`);
      return null;
    },
  };
}

const certificate = { pem: "-----BEGIN CERTIFICATE-----", spki_hash: "spki-of-the-service" };

test("Start Chrome hands Go the connection, its proxy listener and its certificate's SPKI hash", async () => {
  const client = fakeClient({
    "/listener/status": { status: "active", proxy_listener: "127.0.0.1:51390" },
    "/certificate": certificate,
  });
  const launched = [];
  const startChrome = createStartChrome({
    client,
    connection: () => ({ connection: { kind: "local" }, url: "http://127.0.0.1:51391" }),
    launch: async (start) => launched.push(start),
  });
  await startChrome("work");
  assert.deepEqual(launched, [
    {
      profile: "work",
      connectionKind: "local",
      connectionURL: "http://127.0.0.1:51391",
      proxyListener: "127.0.0.1:51390",
      spkiHash: "spki-of-the-service",
    },
  ]);
  assert.ok(!client.calls.some((call) => call.includes("/chrome/")), "never calls the service's /chrome routes");
});

test("a stopped proxy listener reaches Go as no listener, so Go refuses it", async () => {
  const client = fakeClient({
    "/listener/status": { status: "inactive", proxy_listener: null },
    "/certificate": certificate,
  });
  const launched = [];
  const startChrome = createStartChrome({
    client,
    connection: () => ({ connection: { kind: "remote" }, url: "http://lab:1" }),
    launch: async (start) => launched.push(start),
  });
  await startChrome();
  assert.equal(launched[0].proxyListener, "");
  assert.equal(launched[0].profile, "");
  assert.equal(launched[0].connectionKind, "remote");
});

test("a failed certificate read rejects without launching", async () => {
  const client = fakeClient({
    "/listener/status": { status: "active", proxy_listener: "127.0.0.1:1" },
    "/certificate": new Error("GET /certificate: http_error: 500"),
  });
  let launched = false;
  const startChrome = createStartChrome({
    client,
    connection: () => ({ connection: { kind: "local" }, url: "http://127.0.0.1:2" }),
    launch: async () => (launched = true),
  });
  await assert.rejects(startChrome(""), /certificate/);
  assert.equal(launched, false);
});

test("a refusal's text says why Chrome didn't start", () => {
  const fallback = "Error starting Chrome";
  assert.equal(
    chromeErrorText("starting Chrome: listener_inactive: listener inactive", fallback),
    "Start the proxy listener first",
  );
  assert.equal(
    chromeErrorText("starting Chrome: listener_loopback: the remote proxy listener binds loopback only", fallback),
    "Can't reach the proxy: it listens on the service's loopback only",
  );
  assert.equal(
    chromeErrorText(new Error("starting Chrome: chrome_launch_failed (): finding Chrome executable: not found"), fallback),
    "finding Chrome executable: not found",
  );
  assert.equal(chromeErrorText("starting Chrome: invalid configuration: x", fallback), fallback);
  assert.equal(chromeErrorText(new Error("disk full"), fallback), fallback);
});
