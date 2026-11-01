import { test } from "node:test";
import assert from "node:assert/strict";
import { handleLocalChrome, localChromeCalls } from "./localChromeIPC.js";

function fakeIPC() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

// The handlers over a fake local Chrome, for windows whose connections are
// `connections` by webContents id.
function setup(connections) {
  const ipc = fakeIPC();
  const seen = [];
  const record = (name) => async (...args) => (seen.push([name, ...args]), `${name} done`);
  const localChrome = Object.fromEntries(
    ["paths", "addPath", "removePath", "profiles", "addProfile", "removeProfile", "proxyAddress", "setProxyAddress", "start"].map(
      (name) => [name, record(name)],
    ),
  );
  handleLocalChrome(ipc, { localChrome, connectionOf: (id) => connections[id] ?? null });
  const call = (id, name, ...args) => ipc.handlers.get(`localChrome:${name}`)({ sender: { id } }, ...args);
  return { ipc, seen, call };
}

const remote = { origin: "https://203.0.113.5:9443", remote: true };
const local = { origin: "http://127.0.0.1:50037", remote: false };

test("each local Chrome call has its own channel and answers { value }", async () => {
  const { ipc, seen, call } = setup({ 1: local });
  for (const name of localChromeCalls) assert.ok(ipc.handlers.has(`localChrome:${name}`), name);
  assert.deepEqual(await call(1, "addProfile", "work"), { value: "addProfile done" });
  assert.deepEqual(seen, [["addProfile", "work"]]);
});

test("the proxy address is the window's own remote's, whatever the renderer sends", async () => {
  const { seen, call } = setup({ 1: remote });
  await call(1, "proxyAddress", "http://elsewhere:1");
  await call(1, "setProxyAddress", "127.0.0.1:18080");
  await call(1, "start", { profile: "", proxy: "127.0.0.1:18080", spkiHash: "h" });
  assert.deepEqual(seen, [
    ["proxyAddress", remote.origin],
    ["setProxyAddress", remote.origin, "127.0.0.1:18080"],
    ["start", { profile: "", proxy: "127.0.0.1:18080", spkiHash: "h" }],
  ]);
});

test("a window that isn't on a remote connection can't start local Chrome or keep a proxy address", async () => {
  const { seen, call } = setup({ 1: local });
  for (const [name, ...args] of [["start", {}], ["proxyAddress"], ["setProxyAddress", "h:1"]]) {
    assert.match((await call(1, name, ...args)).error, /remote connection/);
    assert.match((await call(2, name, ...args)).error, /remote connection/);
  }
  assert.deepEqual(seen, []);
});
