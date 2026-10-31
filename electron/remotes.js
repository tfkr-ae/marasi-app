// Remote service instances: ones on another machine, reached at their
// network address with their control token. A saved remote keeps its name
// and address in the app config and its token sealed by the OS through
// Electron's safeStorage, so the config file never holds it in plain text.
// `fetch` and `safeStorage` are passed in, so tests use fakes.

// Marasi's control listener answers plain HTTP, or HTTPS behind a proxy.
const schemes = new Set(["http:", "https:"]);

// A refused token, with the remote ({name, url}) to ask the new one for.
const refusedToken = (name, url) =>
  Object.assign(new Error(`${name} refused the token`), { tokenRefused: true, remote: { name, url } });

/** The origin of address `url`, which may leave out http://. */
export function remoteOrigin(url) {
  const text = String(url ?? "").trim();
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new Error(`${JSON.stringify(text)} is not an address`);
  }
  if (!schemes.has(parsed.protocol)) throw new Error("A remote address starts with http:// or https://");
  return parsed.origin;
}

/**
 * The remote instances. `appConfig` is createAppConfig's; `safeStorage` is
 * Electron's (isAsyncEncryptionAvailable, encryptStringAsync,
 * decryptStringAsync, and getSelectedStorageBackend on Linux).
 */
export function createRemotes({ appConfig, safeStorage, fetch }) {
  // Reaches `origin` with `token`; resolves to the connection a window keeps.
  async function reach(origin, token, name) {
    let answer;
    try {
      answer = await fetch(`${origin}/service/status`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      throw new Error(`couldn't reach ${origin}: ${error?.cause?.code ?? error?.message ?? error}`);
    }
    if (answer.status === 401) throw refusedToken(name || origin, origin);
    if (!answer.ok) throw new Error(`${origin} answered ${answer.status}`);
    const status = await answer.json();
    return {
      instance: name || `${status.instance} on ${new URL(origin).host}`,
      origin,
      token,
      remote: true,
      loopbackTurnedOn: false,
    };
  }

  // Whether the OS can seal a token. Linux without a keyring "seals" with a
  // key kept in the app itself, which isn't safe.
  async function canSeal() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    return safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  }

  // Saves the remote at `origin` under `name` with `token` sealed, in place
  // of any remote saved at the same address.
  async function keep(name, origin, token) {
    const sealed = (await safeStorage.encryptStringAsync(token)).toString("base64");
    await appConfig.updateRemoteConnections((saved) => [
      ...saved.filter((entry) => entry.url !== origin),
      { name, url: origin, sealed_token: sealed },
    ]);
  }

  const remotes = {
    /** The saved remotes: [{name, url}]. */
    async list() {
      return (await appConfig.remoteConnections()).map(({ name, url }) => ({ name: String(name ?? ""), url: String(url ?? "") }));
    },

    /**
     * Connects to the instance at `url` with `token`, and when `save` is
     * set, saves it under `name` (replacing a remote at the same address).
     */
    async connect({ url, token, name, save = false }) {
      const origin = remoteOrigin(url);
      const trimmed = String(token ?? "").trim();
      if (!trimmed) throw new Error("Paste the instance's control token");
      if (save && !(await canSeal())) {
        throw new Error("This machine can't keep the token safely, so the remote can't be saved");
      }
      const connection = await reach(origin, trimmed, String(name ?? "").trim());
      if (save) await keep(connection.instance, origin, trimmed);
      return connection;
    },

    /** Connects to the saved remote at `url` with its saved token. */
    async connectSaved(url) {
      const origin = remoteOrigin(url);
      const saved = (await appConfig.remoteConnections()).find((entry) => entry.url === origin);
      if (!saved) throw new Error(`There is no saved remote at ${origin}`);
      let opened;
      try {
        opened = await safeStorage.decryptStringAsync(Buffer.from(String(saved.sealed_token ?? ""), "base64"));
      } catch {
        // A token sealed on another machine or by another user.
        throw refusedToken(saved.name, origin);
      }
      const connection = await reach(origin, opened.result, saved.name);
      // The OS rotated its key: seal the token again with the new one.
      if (opened.shouldReEncrypt) await keep(saved.name, origin, opened.result).catch(() => {});
      return connection;
    },

    /** Removes the saved remote at `url`. */
    async forget(url) {
      const origin = remoteOrigin(url);
      await appConfig.updateRemoteConnections((saved) => saved.filter((entry) => entry.url !== origin));
    },
  };
  return remotes;
}
