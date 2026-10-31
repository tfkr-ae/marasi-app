// The network every update request (release checks and downloads) goes
// through, a port of v1's update_client.go. It is its own Electron session,
// never a window's, so update traffic stays out of the researcher's project.
// It honours the system proxy, except a system proxy that is a Marasi
// listener on this machine: researchers often point the system proxy at
// Marasi, and going through it would put the app's own update traffic in
// their project's Ledger, so then the request goes direct. The listeners
// are read per request, since they can start, stop or move while a
// download runs.
import { isIP } from "node:net";

// Chromium's default port for each kind of proxy in a PAC answer.
const defaultPorts = { PROXY: "80", HTTPS: "443", SOCKS: "1080", SOCKS4: "1080", SOCKS5: "1080" };

// The first proxy of a PAC answer such as "PROXY host:port; DIRECT", as
// {host, port}, or null for DIRECT.
function firstProxy(answer) {
  const [kind, address] = String(answer ?? "").split(";")[0].trim().split(/\s+/);
  if (!address || !defaultPorts[kind]) return null;
  const match = /^\[?([^\]]*?)\]?(?::(\d+))?$/.exec(address);
  if (!match) return null;
  return { host: match[1], port: match[2] ?? defaultPorts[kind] };
}

// "ip:port" or "[ip]:port" as {host, port}.
function splitHostPort(address) {
  const match = /^\[?([^\]]*)\]?:(\d+)$/.exec(String(address ?? ""));
  return match ? { host: match[1], port: match[2] } : null;
}

const isLoopback = (ip) => ip === "::1" || /^127\./.test(ip) || /^::ffff:127\./.test(ip);
const isUnspecified = (ip) => ip === "0.0.0.0" || ip === "::";

/**
 * A fetch for update requests.
 *
 * - resolveProxy(url): the system proxy for url, in Chromium's PAC form
 *   (Electron's session.resolveProxy).
 * - systemFetch and directFetch: fetches through a session that uses the
 *   system proxy, and one that uses none.
 * - marasiListeners(): the "ip:port" proxy listeners of the local instances.
 * - lookup(host): the addresses a host name resolves to.
 * - localAddresses(): this machine's interface addresses.
 */
export function createUpdateFetch({
  resolveProxy,
  systemFetch,
  directFetch,
  marasiListeners,
  lookup = async () => [],
  localAddresses = () => [],
}) {
  async function addresses(host) {
    if (isIP(host)) return [host];
    if (host === "localhost") return ["127.0.0.1", "::1"];
    return lookup(host).catch(() => []);
  }

  // Whether proxy is one of the listeners. A listener may be bound to a
  // wildcard address, and the proxy may name it as localhost or another of
  // this machine's addresses, so they match on port and on reaching the
  // same machine, not as strings.
  async function isMarasiListener(proxy) {
    let listeners;
    try {
      listeners = (await marasiListeners()).map(splitHostPort).filter((l) => l && l.port === proxy.port);
    } catch {
      return false;
    }
    if (!listeners.length) return false;
    const ips = await addresses(proxy.host);
    const local = new Set(localAddresses());
    return listeners.some(({ host }) =>
      ips.some((ip) =>
        isUnspecified(host) ? isLoopback(ip) || local.has(ip) : ip === host || (isLoopback(ip) && isLoopback(host)),
      ),
    );
  }

  return async function updateFetch(url, init) {
    const proxy = firstProxy(await resolveProxy(url).catch(() => "DIRECT"));
    if (proxy && (await isMarasiListener(proxy))) return directFetch(url, init);
    return systemFetch(url, init);
  };
}

// "http://host:port" or "host:port" as Chromium's "host:port".
const proxyAddress = (value) => value.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");

/**
 * The proxy environment variables as Electron proxy rules, or null when
 * none is set and the OS proxy settings apply. They win when any is set, as
 * they do for other tools and did in v1; NO_PROXY bypasses, and this
 * machine is never proxied.
 */
export function envProxyConfig(env) {
  const pick = (...names) => names.map((name) => env[name]).find(Boolean);
  const http = pick("HTTP_PROXY", "http_proxy");
  const https = pick("HTTPS_PROXY", "https_proxy");
  if (!http && !https) return null;
  const rules = [];
  if (http) rules.push(`http=${proxyAddress(http)}`);
  if (https) rules.push(`https=${proxyAddress(https)}`);
  const bypass = pick("NO_PROXY", "no_proxy");
  return { proxyRules: rules.join(";"), proxyBypassRules: [bypass, "<local>"].filter(Boolean).join(",") };
}
