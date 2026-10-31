// Starts a real Marasi the way the app does, on a temporary config
// directory: startup on the default instance, Start, Disconnect and quit.
// Marasi is MARASI_BIN, or the bundled Marasi in resources/bin; with
// neither, the suite is skipped.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createLocalConnections } from "./local.js";
import { callSocket } from "./socket.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = join(root, "resources", "bin", process.platform === "win32" ? "marasi.exe" : "marasi");
const marasiBin = process.env.MARASI_BIN || bundled;
const skip = existsSync(marasiBin) ? false : `no Marasi at ${marasiBin}; set MARASI_BIN`;

let configDir;
const status = (instance) =>
  callSocket(join(configDir, "instances", `${instance}.sock`), "GET", "/service/status").then(
    (answer) => answer.body,
    () => null,
  );
// Waits for `instance` to stop: its socket stops answering.
async function stopped(instance) {
  for (let i = 0; i < 50; i++) {
    if (!(await status(instance))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
const local = () => createLocalConnections({ configDir, run, call: callSocket, marasiBin: () => marasiBin });

before(async () => {
  if (skip) return;
  // A short path: an instance's socket path must stay under 104 bytes.
  configDir = await mkdtemp("/tmp/mv2.");
});

after(async () => {
  if (skip || !configDir) return;
  for (const instance of ["default", "acme", "acme-2"]) {
    await run(marasiBin, ["--config-dir", configDir, "--instance", instance, "--json", "service", "stop"]).catch(() => {});
  }
  await rm(configDir, { recursive: true, force: true });
});

test("startup starts default on the scratchpad, and quitting stops it", { skip }, async () => {
  const connections = local();
  const connection = await connections.startup(1);
  assert.equal(connection.instance, "default");
  const answer = await fetch(`${connection.origin}/service/status`, { headers: { Authorization: `Bearer ${connection.token}` } });
  const body = await answer.json();
  assert.match(body.project, /projects\/scratchpad\.marasi$/);
  assert.equal(`http://${body.control_listener}`, connection.origin);
  assert.deepEqual(await connections.quit(), ["default"]);
  assert.ok(await stopped("default"));
});

test("a default started outside the app is connected to and left running at quit", { skip }, async () => {
  await run(marasiBin, ["--config-dir", configDir, "--json", "service", "start", "--port", "0"]);
  const connections = local();
  const connection = await connections.startup(1);
  assert.equal(connection.loopbackTurnedOn, true);
  assert.deepEqual(await connections.quit(), []);
  assert.equal((await status("default"))?.status, "running");
});

test("Start runs a named instance on a project; disconnecting first leaves it running at quit", { skip }, async () => {
  const connections = local();
  const project = join(configDir, "acme.marasi");
  const connection = await connections.start(1, { instance: "acme", project });
  assert.equal(connection.instance, "acme");
  assert.equal((await status("acme")).project.endsWith("/acme.marasi"), true);
  await assert.rejects(connections.start(2, { instance: "acme", project: null }));
  connections.disconnect(1);
  assert.deepEqual(await connections.quit(), []);
  assert.equal((await status("acme"))?.status, "running");
});

test("the bundled Marasi is the version package.json pins", { skip: existsSync(bundled) ? false : "no bundled Marasi" }, async () => {
  const pin = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).marasi;
  const connections = createLocalConnections({ configDir, run, call: callSocket, marasiBin: () => bundled });
  await connections.start(1, { instance: "acme-2", project: join(configDir, "pin.marasi") });
  assert.equal((await status("acme-2")).version, pin.version);
  await connections.quit();
  assert.ok(await stopped("acme-2"));
});
