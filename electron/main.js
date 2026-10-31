// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createAppConfig } from "./appConfig.js";
import { handleAppConfig } from "./appConfigIPC.js";
import { assetPath } from "./assets.js";
import { withBearer } from "./bearer.js";
import { readBuildInfo } from "./buildInfo.js";
import { marasiConfigDir } from "./configDir.js";
import { listLocalInstances } from "./instances.js";
import { createKeybindingFiles } from "./keybindingFiles.js";
import { createLocalConnections } from "./local.js";
import { bundledMarasi, createMarasiChoice } from "./marasiBin.js";
import { nodeFS } from "./nodeFS.js";
import { callSocket } from "./socket.js";
import { handleUpdates, updateEventChannel } from "./updateIPC.js";
import { defaultInstaller, locateInstall } from "./updater/installers.js";
import { createUpdateFetch, envProxyConfig } from "./updater/updateNet.js";
import { createUpdater } from "./updater/updater.js";

const here = dirname(fileURLToPath(import.meta.url));
// The frontend build is served on app://marasi/, so its absolute /_app/
// paths and the client router work as on a web server.
const scheme = "app";
const origin = `${scheme}://marasi`;
// `npm run dev` points the window at the Vite dev server instead.
const devServerURL = app.isPackaged ? null : process.env.MARASI_DEV_SERVER_URL;
const appOrigin = new URL(devServerURL ?? `${origin}/`).origin;
// Marasi's config directory, where its instances keep their sockets and
// v1 and v2 keep the app config: the one Marasi itself defaults to
// (os.UserConfigDir()/Marasi), unless --config-dir=DIR or MARASI_CONFIG_DIR
// names another, as for a throwaway instance (configDir.js).
const configDir = marasiConfigDir({
  appData: app.getPath("appData"),
  configDirSwitch: app.commandLine.getSwitchValue("config-dir"),
  configDirEnv: process.env.MARASI_CONFIG_DIR,
});
// The Marasi Start runs: the bundled one, or the researcher's choice.
// Read once the app is ready.
let marasi;
// Each window's connection, by its webContents id: {instance, origin,
// token, loopbackTurnedOn}, and the instances the app started. The token
// stays here; the renderer gets the rest.
const connections = createLocalConnections({
  configDir,
  run: promisify(execFile),
  call: callSocket,
  marasiBin: () => marasi.bin(),
});
// The running build ({Channel, Version}) and the signing key it verifies
// updates with, which the build workflow sets in package.json's
// marasiBuild; a checkout or local package is a "dev" build (buildInfo.js).
const { build, signingKey, releaseSource } = readBuildInfo(JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")));
// The app's own updates. Set up once the app is ready.
let updater;

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function serveFrontend() {
  const root = join(app.getAppPath(), "frontend", "build");
  protocol.handle(scheme, (request) => {
    const path = assetPath(root, new URL(request.url).pathname, isFile);
    if (!path) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path).toString());
  });
}

// The app config v1 and v2 share, and the keybinding profile files, for
// every window.
function serveAppConfig() {
  const appConfig = createAppConfig({
    dir: configDir,
    fs: nodeFS,
    defaultTestCases: readFileSync(join(here, "resources", "default_test_cases.yml"), "utf8"),
  });
  const chosen = (result) => (result.canceled ? null : (result.filePath ?? result.filePaths?.[0] ?? null));
  // The dialog is a sheet on the focused window, if there is one.
  const show = (open, options) => {
    const parent = BrowserWindow.getFocusedWindow();
    return parent ? open(parent, options) : open(options);
  };
  const keybindingFiles = createKeybindingFiles({
    fs: nodeFS,
    home: app.getPath("home"),
    dialog: {
      save: async (options) => chosen(await show(dialog.showSaveDialog, options)),
      open: async (options) => chosen(await show(dialog.showOpenDialog, { ...options, properties: ["openFile"] })),
    },
  });
  handleAppConfig({ handle }, { appConfig, keybindingFiles });
  handle("app:buildInfo", () => build);
  // A config v2 can't prepare stays as it is; each read then reports why.
  return [appConfig, appConfig.load().catch((error) => console.error(`preparing ${configDir}:`, error))];
}

// Starts `path` so that it outlives the app, as an installed update's
// relaunch needs.
function spawnDetached(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, [], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

// The network update requests take: their own sessions, one on the system
// proxy (or the proxy environment variables when set) and one direct for
// when that proxy is a local Marasi listener (updater/updateNet.js).
function updateNetwork() {
  const system = session.fromPartition("marasi-updates");
  const direct = session.fromPartition("marasi-updates-direct");
  const fromEnv = envProxyConfig(process.env);
  system.setProxy(fromEnv ? { mode: "fixed_servers", ...fromEnv } : { mode: "system" });
  direct.setProxy({ mode: "direct" });
  return createUpdateFetch({
    resolveProxy: (url) => system.resolveProxy(url),
    systemFetch: (url, init) => system.fetch(url, init),
    directFetch: (url, init) => direct.fetch(url, init),
    marasiListeners: async () =>
      (await listLocalInstances({ configDir, readdir, call: callSocket }))
        .map((status) => status.proxy_listener)
        .filter(Boolean),
    lookup: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
    localAddresses: () => Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((entry) => entry.address)),
  });
}

// The updater, with its settings in the app config's v2_* keys.
async function serveUpdates(appConfig) {
  const run = promisify(execFile);
  const installer = defaultInstaller({ platform: process.platform, fs: fsPromises, run, spawnDetached });
  const installLocation =
    app.isPackaged && installer
      ? await locateInstall({ platform: process.platform, execPath: process.execPath, env: process.env, realpath })
      : "";
  updater = createUpdater({
    build,
    signingKey,
    config: { get: (key) => appConfig.v2Value(key), set: (key, value) => appConfig.setV2Value(key, value) },
    fetch: updateNetwork(),
    releaseSource,
    fs: fsPromises,
    tmpdir: tmpdir(),
    installer,
    installLocation,
    emit: (name, payload) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(updateEventChannel, name, payload);
    },
    confirm: async (title, message) => {
      const parent = BrowserWindow.getFocusedWindow();
      const options = { type: "warning", message: title, detail: message, buttons: [title, "Cancel"], defaultId: 0, cancelId: 1 };
      const { response } = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
      return response === 0;
    },
    // v1 warned here about unsaved Launchpad drafts and active Armory runs.
    // Drafts live in the windows and runs in the instances; the tickets that
    // port them add their warnings.
    confirmLosingWork: async () => true,
    quit: () => app.quit(),
  });
  handleUpdates({ handle }, updater);
  updater.removeUpdateLeftovers();
}

function createWindow() {
  const window = new BrowserWindow({
    title: "Marasi",
    width: 1600,
    height: 900,
    backgroundColor: "#1b2636",
    webPreferences: {
      preload: join(here, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // An ESM preload needs an unsandboxed renderer.
      sandbox: false,
    },
  });
  const home = devServerURL ?? `${origin}/`;
  // Links that leave the app open in the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== appOrigin) event.preventDefault();
  });
  const id = window.webContents.id;
  window.webContents.on("destroyed", () => connections.forget(id));
  window.loadURL(home);
  return window;
}

// The connection a renderer may see: everything but the token.
const shown = (connection) =>
  connection && {
    instance: connection.instance,
    baseURL: connection.origin,
    loopbackTurnedOn: connection.loopbackTurnedOn,
  };

// Answers `channel` with `handle(event, ...args)`, for the app's own pages
// only: a captured page that ended up in a frame gets nothing.
function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (new URL(event.senderFrame.url).origin !== appOrigin) throw new Error("not the app");
    return handler(event, ...args);
  });
}

function serveConnections() {
  // The window's requests to its instance carry the control token.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["http://*/*"] }, (details, callback) =>
    callback({ requestHeaders: withBearer(details, (id) => connections.get(id)) }),
  );
  handle("instances:list", () => listLocalInstances({ configDir, readdir, call: callSocket }));
  handle("connection:startup", async (event) => shown(await connections.startup(event.sender.id)));
  handle("connection:connect", async (event, instance) => shown(await connections.connect(event.sender.id, instance)));
  handle("connection:start", async (event, { instance, project }) =>
    shown(await connections.start(event.sender.id, { instance, project: project || null })),
  );
  handle("connection:disconnect", (event) => connections.disconnect(event.sender.id));
  handle("connection:current", (event) => shown(connections.get(event.sender.id)) ?? null);
  // The project a Start opens, picked in an OS dialog: a path, or null.
  handle("dialog:pick-project", async (event) => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "Project to start",
      filters: [{ name: "Marasi project", extensions: ["marasi"] }],
      properties: ["openFile", "createDirectory", "promptToCreate"],
    });
    return picked.canceled ? null : picked.filePaths[0];
  });
  handle("marasi:current", () => marasi.shown());
  // Chooses the Marasi Start runs from a path in an OS dialog, or goes back
  // to the bundled one when `bundled` is set.
  handle("marasi:choose", async (event, { bundled = false } = {}) => {
    if (bundled) {
      await marasi.choose(null);
      return marasi.shown();
    }
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "Marasi to start",
      properties: ["openFile"],
    });
    if (!picked.canceled) await marasi.choose(picked.filePaths[0]);
    return marasi.shown();
  });
}

app.whenReady().then(async () => {
  marasi = await createMarasiChoice({
    file: join(app.getPath("userData"), "marasi.json"),
    bundled: bundledMarasi({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
    }),
    readFile,
    writeFile,
  });
  serveFrontend();
  serveConnections();
  const [appConfig, loaded] = serveAppConfig();
  await serveUpdates(appConfig);
  await loaded;
  createWindow();
  updater.startUpdateChecks();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the window quits the app.
app.on("window-all-closed", () => app.quit());
// Quitting stops the update checks and the instances the app started and
// wasn't disconnected from, relaunches an installed update when quitting
// for "Restart now", then quits for real.
let stopping = false;
app.on("before-quit", (event) => {
  if (stopping) return;
  stopping = true;
  event.preventDefault();
  Promise.allSettled([updater?.stopUpdateChecks(), connections.quit()])
    .then(() => updater?.relaunchIfRestarting())
    .finally(() => app.quit());
});
