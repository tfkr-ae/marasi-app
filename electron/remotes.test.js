import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppConfig } from "./appConfig.js";
import { createRemotes } from "./remotes.js";
import { memoryFS } from "./testing/memoryFS.js";

const dir = "/config/Marasi";
const path = `${dir}/marasi_appconfig.yaml`;
const token = "7b6ec529de1544c621aae97c8641c7fbb2026d71b017e216bbe616c1b5997bd1";

const status = (instance = "default") => ({
  status: "running",
  instance,
  project: `/srv/marasi/projects/${instance}.marasi`,
  control_listener: "0.0.0.0:7070",
});

// Electron's safeStorage, with a reversible stand-in for the OS keychain.
// `backend` is Linux's password store, and `rotated` makes a decrypt ask
// for the token to be sealed again.
function fakeSafeStorage({ available = true, backend, rotated = false } = {}) {
  return {
    sealed: 0,
    isAsyncEncryptionAvailable: async () => available,
    ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
    async encryptStringAsync(text) {
      this.sealed++;
      return Buffer.from(`sealed:${[...text].reverse().join("")}`);
    },
    decryptStringAsync: async (buffer) => {
      const text = buffer.toString();
      if (!text.startsWith("sealed:")) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      return { result: [...text.slice("sealed:".length)].reverse().join(""), shouldReEncrypt: rotated };
    },
  };
}

// A network where instance `origin` answers /service/status to `token`
// only, recording each request.
function fakeNetwork(instances) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), authorization: init.headers?.Authorization });
    const { origin, pathname } = new URL(url);
    const instance = instances[origin];
    if (!instance) throw new TypeError("fetch failed");
    if (init.headers?.Authorization !== `Bearer ${instance.token}`) {
      return new Response(JSON.stringify({ error: "unauthorized", message: "send the control token as Authorization: Bearer" }), { status: 401 });
    }
    if (pathname !== "/service/status") return new Response("404 page not found", { status: 404 });
    return new Response(JSON.stringify(status(instance.name)), { status: 200 });
  };
  return { fetch, requests };
}

function setup({ fs = memoryFS(), instances = { "http://10.1.26.31:7070": { name: "lab", token } }, ...storage } = {}) {
  const appConfig = createAppConfig({ dir, fs, platform: "darwin" });
  const network = fakeNetwork(instances);
  const safeStorage = fakeSafeStorage(storage);
  const remotes = createRemotes({ appConfig, safeStorage, fetch: network.fetch });
  return { fs, remotes, network, instances, safeStorage };
}

test("connecting by address and token reaches the instance with the token", async () => {
  const { remotes, network } = setup();
  const connection = await remotes.connect({ url: "10.1.26.31:7070", token: ` ${token}\n` });
  assert.deepEqual(connection, {
    instance: "lab on 10.1.26.31:7070",
    origin: "http://10.1.26.31:7070",
    token,
    remote: true,
    loopbackTurnedOn: false,
  });
  assert.deepEqual(network.requests, [{ url: "http://10.1.26.31:7070/service/status", authorization: `Bearer ${token}` }]);
});

test("a refused token, a bad address and an unreachable instance say so", async () => {
  const { remotes } = setup();
  await assert.rejects(remotes.connect({ url: "http://10.1.26.31:7070", token: "nope" }), (error) => {
    assert.equal(error.tokenRefused, true);
    assert.match(error.message, /refused the token/);
    return true;
  });
  await assert.rejects(remotes.connect({ url: "ftp://10.1.26.31", token }), /http:\/\/ or https:\/\//);
  await assert.rejects(remotes.connect({ url: "http://10.1.26.31:7070", token: "" }), /token/);
  await assert.rejects(remotes.connect({ url: "http://10.9.9.9:7070", token }), /couldn't reach http:\/\/10\.9\.9\.9:7070/);
});

test("a saved remote reconnects after a restart without its token, which the file keeps sealed", async () => {
  const fs = memoryFS();
  const first = setup({ fs });
  await first.remotes.connect({ url: "http://10.1.26.31:7070/ignored/path", token, name: "Lab box", save: true });
  const file = fs.files.get(path);
  assert.doesNotMatch(file, new RegExp(token));
  assert.match(file, /^v2_remote_connections:/m);

  const restarted = setup({ fs });
  assert.deepEqual(await restarted.remotes.list(), [{ name: "Lab box", url: "http://10.1.26.31:7070" }]);
  const connection = await restarted.remotes.connectSaved("http://10.1.26.31:7070");
  assert.equal(connection.instance, "Lab box");
  assert.equal(connection.token, token);
});

test("saving the same address again replaces its name and token; forgetting removes it", async () => {
  const { remotes, instances } = setup();
  await remotes.connect({ url: "http://10.1.26.31:7070", token, name: "Lab", save: true });
  instances["http://10.1.26.31:7070"].token = "f".repeat(64);
  await remotes.connect({ url: "http://10.1.26.31:7070", token: "f".repeat(64), name: "Lab box", save: true });
  assert.deepEqual(await remotes.list(), [{ name: "Lab box", url: "http://10.1.26.31:7070" }]);
  assert.equal((await remotes.connectSaved("http://10.1.26.31:7070")).token, "f".repeat(64));
  await remotes.forget("http://10.1.26.31:7070");
  assert.deepEqual(await remotes.list(), []);
});

test("a saved remote whose token was rotated asks for the new one", async () => {
  const { remotes, instances } = setup();
  await remotes.connect({ url: "http://10.1.26.31:7070", token, save: true });
  instances["http://10.1.26.31:7070"].token = "a".repeat(64);
  await assert.rejects(remotes.connectSaved("http://10.1.26.31:7070"), (error) => error.tokenRefused === true);
  await assert.rejects(remotes.connectSaved("http://10.1.1.1:1"), /no saved remote/);
});

test("without OS encryption a remote connects but isn't saved", async () => {
  const { remotes, fs } = setup({ available: false });
  await assert.rejects(
    remotes.connect({ url: "http://10.1.26.31:7070", token, save: true }),
    /can't keep the token safely/,
  );
  assert.equal(fs.files.has(path), false);
  assert.ok(await remotes.connect({ url: "http://10.1.26.31:7070", token }));
  const linux = setup({ backend: "basic_text" });
  await assert.rejects(linux.remotes.connect({ url: "http://10.1.26.31:7070", token, save: true }), /can't keep the token safely/);
  assert.ok(await setup({ backend: "gnome_libsecret" }).remotes.connect({ url: "http://10.1.26.31:7070", token, save: true }));
});

test("a token sealed with a rotated OS key is sealed again", async () => {
  const fs = memoryFS();
  await setup({ fs }).remotes.connect({ url: "http://10.1.26.31:7070", token, name: "Lab box", save: true });
  const restarted = setup({ fs, rotated: true });
  assert.equal((await restarted.remotes.connectSaved("http://10.1.26.31:7070")).token, token);
  assert.equal(restarted.safeStorage.sealed, 1);
  assert.deepEqual(await restarted.remotes.list(), [{ name: "Lab box", url: "http://10.1.26.31:7070" }]);
});
