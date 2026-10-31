// Starts a real Marasi on a temporary config directory and connects to it
// the way a window does: discovery and the token through the socket, the
// header the session adds, and the renderer's client module. Marasi is
// MARASI_BIN, or the bundled Marasi in resources/bin; with neither, the
// suite is skipped.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectLocal, listLocalInstances } from "./instances.js";
import { callSocket } from "./socket.js";
import { withBearer } from "./bearer.js";
import { createMarasiClient, isNeedsNewerMarasi } from "../frontend/src/lib/bindings/marasi.js";
import { codeIDs } from "../frontend/src/lib/errorCodes.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const marasiBin = process.env.MARASI_BIN || join(root, "resources", "bin", process.platform === "win32" ? "marasi.exe" : "marasi");
const skip = existsSync(marasiBin) ? false : `no Marasi at ${marasiBin}; set MARASI_BIN`;

let configDir;
const instance = "itest";
const marasi = (...args) => run(marasiBin, ["--config-dir", configDir, "--instance", instance, "--json", ...args]);

// The fetch a connected window makes: the session adds the token to
// requests to its instance's origin.
const windowFetch = (connection) => (url, init = {}) =>
  fetch(url, {
    ...init,
    headers: withBearer({ url: String(url), webContentsId: 1, requestHeaders: init.headers ?? {} }, (id) =>
      id === 1 ? connection : null,
    ),
  });

before(async () => {
  if (skip) return;
  // A short path: the instance's socket path must stay under 104 bytes.
  configDir = await mkdtemp("/tmp/mv2.");
  // No network address, so connecting turns one on.
  await marasi("service", "start", "--port", "0");
});

after(async () => {
  if (skip || !configDir) return;
  await marasi("service", "stop").catch(() => {});
  await rm(configDir, { recursive: true, force: true });
});

let connection;

test("discovery lists the running instance with its project, version and listener", { skip }, async () => {
  const items = await listLocalInstances({ configDir, readdir, call: callSocket });
  assert.equal(items.length, 1);
  assert.equal(items[0].instance, instance);
  assert.match(items[0].project, /scratchpad\.marasi$/);
  assert.ok(items[0].version);
  assert.match(items[0].proxy_listener, /^127\.0\.0\.1:\d+$/);
  assert.equal(items[0].control_listener, null);
});

test("connecting turns on a loopback address and fetches the status through the client", { skip }, async () => {
  connection = await connectLocal({ configDir, instance, call: callSocket });
  assert.equal(connection.loopbackTurnedOn, true);
  assert.match(connection.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const status = await client.get("/service/status");
  assert.equal(status.instance, instance);
  assert.equal(`http://${status.control_listener}`, connection.origin);
});

test("connecting again keeps the network address it has", { skip }, async () => {
  const again = await connectLocal({ configDir, instance, call: callSocket });
  assert.equal(again.loopbackTurnedOn, false);
  assert.equal(again.origin, connection.origin);
  assert.equal(again.token, connection.token);
});

test("the network address needs the header the session adds", { skip }, async () => {
  const bare = await fetch(`${connection.origin}/service/status`);
  assert.equal(bare.status, 401);
  // Only the window's own instance gets the token.
  const elsewhere = withBearer(
    { url: "http://127.0.0.1:1/service/status", webContentsId: 1, requestHeaders: {} },
    () => connection,
  );
  assert.equal(elsewhere.Authorization, undefined);
});

test("a coded refusal reaches the caller as an error the code helpers read", { skip }, async () => {
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const error = await client.post("/project/open", {}).then(
    () => assert.fail("opened"),
    (err) => err,
  );
  assert.equal(error.status, 400);
  assert.deepEqual(codeIDs(error, "invalid_project_request"), []);
});

test("an unknown route reads Needs a newer Marasi", { skip }, async () => {
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const error = await client.get("/no-such-route").then(
    () => assert.fail("answered"),
    (err) => err,
  );
  assert.ok(isNeedsNewerMarasi(error));
  assert.equal(String(error), "Needs a newer Marasi");
});
