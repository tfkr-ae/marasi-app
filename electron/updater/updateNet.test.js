import assert from "node:assert/strict";
import { test } from "node:test";
import { createUpdateFetch, envProxyConfig } from "./updateNet.js";

// An update fetch whose system proxy is `proxy` and whose local Marasi
// listeners are `listeners`; it reports which session each request took.
function setup({ proxy, listeners = [], local = [] }) {
  const took = [];
  const fetch = createUpdateFetch({
    resolveProxy: async () => proxy,
    systemFetch: async (url) => took.push(["system", url]),
    directFetch: async (url) => took.push(["direct", url]),
    marasiListeners: async () => listeners,
    lookup: async (host) => (host === "proxy.corp" ? ["10.0.0.5"] : []),
    localAddresses: () => ["192.168.1.20", ...local],
  });
  return { fetch, took };
}

test("an update request goes through the system proxy", async () => {
  const { fetch, took } = setup({ proxy: "PROXY proxy.corp:3128", listeners: ["127.0.0.1:8080"] });
  await fetch("https://api.github.com/x");
  assert.deepEqual(took, [["system", "https://api.github.com/x"]]);
});

test("an update request bypasses a system proxy that is a Marasi listener", async () => {
  const cases = [
    ["PROXY 127.0.0.1:8080", "127.0.0.1:8080"],
    ["PROXY localhost:8080", "127.0.0.1:8080"],
    ["PROXY localhost:8080; DIRECT", "0.0.0.0:8080"],
    ["PROXY 192.168.1.20:8080", "[::]:8080"],
    ["PROXY 192.168.1.20:8080", "192.168.1.20:8080"],
  ];
  for (const [proxy, listener] of cases) {
    const { fetch, took } = setup({ proxy, listeners: ["127.0.0.1:9999", listener] });
    await fetch("https://api.github.com/x");
    assert.deepEqual(took, [["direct", "https://api.github.com/x"]], `${proxy} with ${listener}`);
  }
});

test("a proxy on another port or machine than every Marasi listener is used", async () => {
  for (const [proxy, listener] of [
    ["PROXY 127.0.0.1:8081", "127.0.0.1:8080"],
    ["PROXY proxy.corp:8080", "0.0.0.0:8080"],
    ["PROXY 192.168.1.20:8080", "127.0.0.1:8080"],
  ]) {
    const { fetch, took } = setup({ proxy, listeners: [listener] });
    await fetch("https://api.github.com/x");
    assert.deepEqual(took, [["system", "https://api.github.com/x"]], `${proxy} with ${listener}`);
  }
});

test("no system proxy, or listeners that can't be read, go through the system session", async () => {
  const { fetch, took } = setup({ proxy: "DIRECT", listeners: ["127.0.0.1:8080"] });
  await fetch("https://a");
  const broken = createUpdateFetch({
    resolveProxy: async () => "PROXY 127.0.0.1:8080",
    systemFetch: async () => took.push(["system", "https://b"]),
    directFetch: async () => took.push(["direct", "https://b"]),
    marasiListeners: async () => {
      throw new Error("no instances dir");
    },
  });
  await broken("https://b");
  assert.deepEqual(took, [["system", "https://a"], ["system", "https://b"]]);
});

test("the proxy environment variables win, as they do for other tools", () => {
  assert.equal(envProxyConfig({}), null);
  assert.deepEqual(envProxyConfig({ HTTPS_PROXY: "http://proxy.corp:3128", NO_PROXY: "localhost,.corp" }), {
    proxyRules: "https=proxy.corp:3128",
    proxyBypassRules: "localhost,.corp,<local>",
  });
  assert.deepEqual(envProxyConfig({ http_proxy: "proxy:80", https_proxy: "sproxy:443" }), {
    proxyRules: "http=proxy:80;https=sproxy:443",
    proxyBypassRules: "<local>",
  });
});
