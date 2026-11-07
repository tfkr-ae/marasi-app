import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInterface, interfaceOptions, isShared, pairingWithHost, qrPath } from "./sharing.js";

const items = [
  { address: "127.0.0.1", family: "ipv4", interface: "lo0" },
  { address: "192.168.1.20", family: "ipv4", interface: "en0" },
  { address: "fe80::1", family: "ipv6", interface: "en0" },
  { address: "100.101.2.3", family: "ipv4", interface: "utun4" },
];

test("the interfaces list every address, plus all interfaces, loopback last", () => {
  assert.deepEqual(
    interfaceOptions(items).map((o) => o.address),
    ["192.168.1.20", "fe80::1", "100.101.2.3", "0.0.0.0", "127.0.0.1"],
  );
  assert.equal(interfaceOptions(items)[0].label, "192.168.1.20 · en0");
});

test("the default interface is Tailscale's when there is one, else the first IPv4 beyond loopback", () => {
  assert.equal(defaultInterface(items), "100.101.2.3");
  assert.equal(defaultInterface(items.slice(0, 3)), "192.168.1.20");
  assert.equal(defaultInterface([items[0]]), "0.0.0.0");
});

test("a listener beyond loopback is shared", () => {
  assert.equal(isShared({ address: "127.0.0.1:51391" }), false);
  assert.equal(isShared({ address: "[::1]:51391" }), false);
  assert.equal(isShared({ address: "100.101.2.3:9000" }), true);
  assert.equal(isShared(null), false);
});

test("the host override replaces the URL's host and keeps its port, as marasi pair --host does", () => {
  const pairing = { url: "http://100.101.2.3:9000", password: "pw", instance: "default" };
  assert.deepEqual(pairingWithHost(pairing, "mac.tail1234.ts.net"), { ...pairing, url: "http://mac.tail1234.ts.net:9000" });
  assert.equal(pairingWithHost(pairing, "fd7a::5").url, "http://[fd7a::5]:9000");
  assert.equal(pairingWithHost(pairing, "").url, "http://100.101.2.3:9000");
  assert.throws(() => pairingWithHost(pairing, "a/b"), /isn't a host/);
});

test("without a password the payload carries no password field", () => {
  const pairing = { url: "http://100.101.2.3:9000", password: "", instance: "default" };
  assert.deepEqual(pairingWithHost(pairing, ""), { url: "http://100.101.2.3:9000", instance: "default" });
});

test("the QR code is a square of modules inside a quiet zone", () => {
  const { size, path } = qrPath('{"url":"http://100.101.2.3:9000","password":"pw","instance":"default"}');
  // 68 bytes at level M is version 5, 37 modules, plus 4 quiet modules each side.
  assert.equal(size, 45);
  assert.match(path, /^M4 4h7v1h-7z/);
});
