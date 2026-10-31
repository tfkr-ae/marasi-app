// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, safeStorage, session, shell } from "electron";
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createAppConfig } from "./appConfig.js";
import { createCertificateFile } from "./certificateFile.js";
import { handleAppConfig } from "./appConfigIPC.js";
import { assetPath } from "./assets.js";
import { withBearer } from "./bearer.js";
import { marasiConfigDir } from "./configDir.js";
import { listLocalInstances } from "./instances.js";
import { createKeybindingFiles } from "./keybindingFiles.js";
import { createLocalConnections } from "./local.js";
import { bundledMarasi, createMarasiChoice, runsBundled } from "./marasiBin.js";
import { nodeFS } from "./nodeFS.js";
import { createRemotes } from "./remotes.js";
import { callSocket, streamSocket } from "./socket.js";
import { watchToken } from "./tokenWatch.js";

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
// token, loopbackTurnedOn, remote}, and the instances the app started. The
// token stays here; the renderer gets the rest.
const connections = createLocalConnections({
  configDir,
  run: promisify(execFile),
  call: callSocket,
  marasiBin: () => marasi.bin(),
});
// Each window's token watch (tokenWatch.js): {connection, watch}.
const watches = new Map();
// The remote, {name, url}, whose refused token took each window back to
// the connection screen, until the screen has asked for the new one.
const refusedRemotes = new Map();
// The app's own update channel, as v1's GetBuildInfo reported it. Builds
// stay "dev" until the updater ticket gives them a channel.
const buildChannel = "dev";

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

// The app config v1 and v2 share, the keybinding profile files, and the
// certificate file and clipboard, for every window.
async function serveAppConfig() {
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
  // The instance's CA certificate, which the renderer read from its
  // instance, saved or copied on this machine.
  const certificateFile = createCertificateFile({
    fs: nodeFS,
    home: app.getPath("home"),
    dialog: { save: async (options) => chosen(await show(dialog.showSaveDialog, options)) },
  });
  handle("certificate:save", (event, pem) => certificateFile.save(pem));
  handle("clipboard:writeText", (event, text) => clipboard.writeText(String(text)));
  handle("app:buildInfo", () => ({ Channel: buildChannel, Version: app.getVersion() }));
  // A config v2 can't prepare stays as it is; each read then reports why.
  await appConfig.load().catch((error) => console.error(`preparing ${configDir}:`, error));
  return appConfig;
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
  window.webContents.on("destroyed", () => {
    connections.forget(id);
    unfollow(id);
    refusedRemotes.delete(id);
  });
  window.loadURL(home);
  return window;
}

// The connection a renderer may see: everything but the token.
const shown = (connection) =>
  connection && {
    instance: connection.instance,
    baseURL: connection.origin,
    loopbackTurnedOn: connection.loopbackTurnedOn,
    remote: Boolean(connection.remote),
  };

// Answers `channel` with `handle(event, ...args)`, for the app's own pages
// only: a captured page that ended up in a frame gets nothing.
function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (new URL(event.senderFrame.url).origin !== appOrigin) throw new Error("not the app");
    return handler(event, ...args);
  });
}

function unfollow(id) {
  watches.get(id)?.watch.stop();
  watches.delete(id);
}

// Follows window `contents`'s connection for a rotated token, from when
// it is set until it changes or ends. A remote that refuses its token
// disconnects the window and reloads it into the connection screen, which
// asks for the new one. Returns the connection as the renderer sees it.
function follow(contents) {
  const id = contents.id;
  const connection = connections.get(id);
  if (!connection) {
    unfollow(id);
    return null;
  }
  if (watches.get(id)?.connection === connection) return shown(connection);
  unfollow(id);
  const watch = watchToken(connection, {
    configDir,
    streamSocket,
    call: callSocket,
    fetch,
    onRefused: () => {
      if (connections.get(id) !== connection) return;
      connections.disconnect(id);
      unfollow(id);
      refusedRemotes.set(id, { name: connection.instance, url: connection.origin });
      if (!contents.isDestroyed()) contents.reload();
    },
  });
  watches.set(id, { connection, watch });
  refusedRemotes.delete(id);
  return shown(connection);
}

// A remote call's answer, { value } or { error, tokenRefused, remote }, so
// the renderer can tell a refused token from another failure.
async function answer(work) {
  try {
    return { value: await work() };
  } catch (error) {
    return { error: error?.message ?? String(error), tokenRefused: Boolean(error?.tokenRefused), remote: error?.remote };
  }
}

function serveConnections(appConfig) {
  const urls = ["http://*/*", "https://*/*"];
  // The window's requests to its instance carry the control token.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) =>
    callback({ requestHeaders: withBearer(details, (id) => connections.get(id)) }),
  );
  // A 401 from the window's instance: its token was rotated.
  session.defaultSession.webRequest.onCompleted({ urls }, (details) => {
    const followed = details.webContentsId == null ? null : watches.get(details.webContentsId);
    if (details.statusCode === 401 && followed && new URL(details.url).origin === followed.connection.origin) {
      followed.watch.refused();
    }
  });
  const remotes = createRemotes({ appConfig, safeStorage, fetch });
  handle("instances:list", () => listLocalInstances({ configDir, readdir, call: callSocket }));
  handle("connection:startup", async (event) => {
    await connections.startup(event.sender.id);
    return follow(event.sender);
  });
  handle("connection:connect", async (event, instance) => {
    await connections.connect(event.sender.id, instance);
    return follow(event.sender);
  });
  handle("connection:start", async (event, { instance, project }) => {
    await connections.start(event.sender.id, { instance, project: project || null });
    return follow(event.sender);
  });
  handle("connection:disconnect", (event) => {
    connections.disconnect(event.sender.id);
    unfollow(event.sender.id);
  });
  handle("connection:current", (event) => shown(connections.get(event.sender.id)) ?? null);
  // Remote instances: the saved ones, and connecting by address and token.
  const useRemote = (contents) => async (connection) => {
    connections.use(contents.id, connection);
    return follow(contents);
  };
  handle("remotes:list", () => remotes.list());
  handle("remotes:connect", (event, form) => answer(() => remotes.connect(form).then(useRemote(event.sender))));
  handle("remotes:connectSaved", (event, url) => answer(() => remotes.connectSaved(url).then(useRemote(event.sender))));
  handle("remotes:forget", (_event, url) => remotes.forget(url));
  handle("remotes:refused", (event) => refusedRemotes.get(event.sender.id) ?? null);
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
  // Whether a local instance's build path is the bundled Marasi.
  handle("marasi:runs-bundled", (event, installPath) =>
    runsBundled(installPath, { bundled: marasi.shown().bundled, realpath }),
  );
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
  serveConnections(await serveAppConfig());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the window quits the app.
app.on("window-all-closed", () => app.quit());
// Quitting stops the instances the app started and wasn't disconnected
// from, then quits for real.
let stopping = false;
app.on("before-quit", (event) => {
  if (stopping) return;
  stopping = true;
  event.preventDefault();
  connections.quit().finally(() => app.quit());
});
