// Sharing the local instance: the service host's interfaces to share on
// (GET /listener/interfaces), whether the control listener is shared, the
// pairing payload with the host override, and its QR code.
import qrcode from "qrcode-generator";
import { isIP } from "../../stores/createConnectionStore.js";

const ALL = "0.0.0.0";
const loopback = (address) => address === "::1" || address.startsWith("127.");
// Tailscale hands out addresses in 100.64.0.0/10.
const tailscale = (address) => {
  const m = /^100\.(\d+)\./.exec(address);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
};

/** The select's options, `{address, label}`: every address, all interfaces, then loopback. */
export function interfaceOptions(items = []) {
  const options = items.map((i) => ({ address: i.address, label: `${i.address} · ${i.interface}` }));
  return [
    ...options.filter((o) => !loopback(o.address)),
    { address: ALL, label: `${ALL} · all interfaces` },
    ...options.filter((o) => loopback(o.address)),
  ];
}

/** The interface to offer first: Tailscale's, else the first IPv4 beyond loopback, else all. */
export function defaultInterface(items = []) {
  const ipv4 = items.filter((i) => i.family === "ipv4" && !loopback(i.address));
  return (ipv4.find((i) => tailscale(i.address)) ?? ipv4[0])?.address ?? ALL;
}

/** Whether the control listener `{address}` is reachable beyond loopback. */
export function isShared(control) {
  const address = control?.address;
  if (!address) return false;
  const host = address.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return !loopback(host) && host !== "localhost";
}

/**
 * The payload another client pairs with: `pairing` with its URL's host
 * replaced by `host` (port kept), as `marasi service control pair --host`
 * does, and no password field when there is none.
 */
export function pairingWithHost(pairing, host = "") {
  const value = String(host).trim();
  let url = pairing.url;
  if (value) {
    if (!isIP(value) && /[:/?#@[\]%\s]/.test(value)) throw new Error(`${value} isn't a host`);
    const parsed = new URL(pairing.url);
    parsed.hostname = value.includes(":") ? `[${value}]` : value;
    url = parsed.toString().replace(/\/$/, "");
  }
  return pairing.password
    ? { url, password: pairing.password, instance: pairing.instance }
    : { url, instance: pairing.instance };
}

// The payload is JSON, so an instance name may be any text: encode UTF-8.
qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

/** The QR code's quiet zone, in modules: the four the QR spec asks for. */
const QUIET = 4;

/**
 * The QR code of `text` at level M as one SVG path of dark modules, each
 * row's runs merged, inside a quiet zone; `size` is the viewBox side.
 */
export function qrPath(text) {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const count = code.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!code.isDark(row, col)) continue;
      let run = 1;
      while (col + run < count && code.isDark(row, col + run)) run++;
      path += `M${col + QUIET} ${row + QUIET}h${run}v1h-${run}z`;
      col += run - 1;
    }
  }
  return { size: count + QUIET * 2, path };
}
