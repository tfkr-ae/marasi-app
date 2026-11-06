// The listener modal's interfaces: the service host's addresses, and which
// one starts selected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listenerAddresses, startingInterface } from "./listenerInterfaces.js";

test("the modal lists the service host's addresses in the service's order", async () => {
  const calls = [];
  const client = {
    get: async (path) => (
      calls.push(path),
      {
        items: [
          { address: "10.0.0.5", family: "ipv4", interface: "eth0" },
          { address: "127.0.0.1", family: "ipv4", interface: "lo" },
          { address: "fe80::1%en0", family: "ipv6", interface: "en0" },
        ],
      }
    ),
  };
  assert.deepEqual(await listenerAddresses(client), ["10.0.0.5", "127.0.0.1", "fe80::1%en0"]);
  assert.deepEqual(calls, ["/listener/interfaces"]);
});

test("the running listener's address starts selected, else the first", () => {
  const list = ["10.0.0.5", "127.0.0.1"];
  assert.equal(startingInterface(list, "127.0.0.1"), 1);
  assert.equal(startingInterface(list, "0.0.0.0"), 0);
  assert.equal(startingInterface(list, ""), 0);
});
