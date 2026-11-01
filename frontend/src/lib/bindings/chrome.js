// The Chrome bindings, by v1's names. On a local connection Chrome is the
// instance's: its paths and profiles are the machine's, and Start Chrome
// opens a window on it through the instance's proxy listener. On a remote
// connection Chrome is this machine's (electron/localChrome.js): the app's
// own paths and profiles, opened through the remote's proxy listener at the
// connection's host, or the address saved for the remote, trusting the
// instance's CA from GET /certificate.
import { isRemoteConnection, marasi } from "./marasi.js";

/** A refusal from the main process's local Chrome. Shown as its message. */
export class LocalChromeError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalChromeError";
  }

  toString() {
    return this.message;
  }
}

// A GET /chrome/path list as v1's [{OS, Path}], and a profile list as names.
const chromePaths = (items = []) => items.map((item) => ({ OS: item.os, Path: item.path }));
const chromeProfiles = (answer) => (answer?.items ?? []).map((item) => item.name);
const chromeProfilePath = (name) => `/chrome/profile/${encodeURIComponent(name)}`;

// The port of a proxy listener "host:port", "" for none.
const listenerPort = (listener) => /:(\d+)$/.exec(listener ?? "")?.[1] ?? "";

/** The bindings, calling the local Chrome bridge `bridge()` returns. */
export function createChromeBindings(bridge) {
  async function local(name, ...args) {
    const calls = bridge();
    if (!calls) throw new LocalChromeError("This machine's Chrome needs the Marasi app window");
    const reply = await calls[name](...args);
    if (reply?.error) throw new LocalChromeError(reply.error);
    return reply?.value;
  }

  // The instance's call on a local connection, this machine's on a remote one.
  const either =
    (instanceCall, localCall) =>
    (...args) =>
      isRemoteConnection() ? localCall(...args) : instanceCall(...args);

  // The remote's listener status, and its default proxy address: the
  // connection's host with the listener's port.
  async function remoteListener() {
    const status = await marasi.get("/listener/status");
    const port = listenerPort(status?.proxy_listener);
    return { status, defaultAddress: port ? `${new URL(marasi.baseURL()).hostname}:${port}` : "" };
  }

  return {
    GetChromePaths: either(
      async () => chromePaths((await marasi.get("/chrome/path")).items),
      async () => chromePaths(await local("paths")),
    ),
    AddChromePath: either(
      async (path, os) => chromePaths((await marasi.post("/chrome/path", { os, path })).items),
      async (path, os) => chromePaths(await local("addPath", path, os)),
    ),
    DeleteChromePath: either(
      async (path, os) => chromePaths((await marasi.delete("/chrome/path", { os, path })).items),
      async (path, os) => chromePaths(await local("removePath", path, os)),
    ),
    GetChromeProfiles: either(
      async () => chromeProfiles(await marasi.get("/chrome/profile")),
      () => local("profiles"),
    ),
    AddChromeProfile: either(
      async (name) => chromeProfiles(await marasi.post("/chrome/profile", { name })),
      (name) => local("addProfile", name),
    ),
    DeleteChromeProfile: either(
      async (name) => chromeProfiles(await marasi.delete(chromeProfilePath(name))),
      (name) => local("removeProfile", name),
    ),
    // Opens a Chrome window on `profile`, or the default profile for "". The
    // app opens it for the researcher, so it asks for no CDP endpoint, as v1.
    StartBrowser: either(
      async (profile) => {
        await marasi.post("/chrome/start", profile ? { profile } : {});
      },
      async (profile) => {
        const [{ status, defaultAddress }, certificate, saved] = await Promise.all([
          remoteListener(),
          marasi.get("/certificate"),
          local("proxyAddress"),
        ]);
        if (status?.status !== "active") {
          throw new LocalChromeError("start chrome: listener_inactive: the remote's proxy listener is off");
        }
        await local("start", { profile, proxy: saved || defaultAddress, spkiHash: certificate?.spki_hash });
      },
    ),
    /**
     * The proxy address this machine's Chrome uses for the remote:
     * {Address, Default}, Address "" while it uses Default.
     */
    async GetLocalChromeProxy() {
      const [{ defaultAddress }, saved] = await Promise.all([remoteListener(), local("proxyAddress")]);
      return { Address: saved, Default: defaultAddress };
    },
    /** Saves the remote's proxy address, "" for its default; resolves it as saved. */
    SetLocalChromeProxy: (address) => local("setProxyAddress", address),
  };
}
