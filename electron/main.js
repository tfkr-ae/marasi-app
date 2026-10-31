// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } from "electron";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAppConfig } from "./appConfig.js";
import { handleAppConfig } from "./appConfigIPC.js";
import { assetPath } from "./assets.js";
import { withBearer } from "./bearer.js";
import { marasiConfigDir } from "./configDir.js";
import { connectLocal, listLocalInstances } from "./instances.js";
import { createKeybindingFiles } from "./keybindingFiles.js";
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
// Each window's connection, by its webContents id: {instance, origin,
// token, loopbackTurnedOn, remote, watch}. The token stays here; the
// renderer gets the rest. `watch` follows it for a rotated token
// (tokenWatch.js).
const connections = new Map();
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

// The app config v1 and v2 share, and the keybinding profile files, for
// every window.
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
    connections.get(id)?.watch.stop();
    connections.delete(id);
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

// Makes `connection` the window's, following it for a rotated token. A
// remote that refuses its token takes the window back to the connection
// screen, which asks for the new one.
function adopt(contents, connection) {
  connections.get(contents.id)?.watch.stop();
  connection.watch = watchToken(connection, {
    configDir,
    streamSocket,
    call: callSocket,
    fetch,
    onRefused: () => {
      if (connections.get(contents.id) !== connection) return;
      connections.delete(contents.id);
      refusedRemotes.set(contents.id, { name: connection.instance, url: connection.origin });
      if (!contents.isDestroyed()) contents.reload();
    },
  });
  connections.set(contents.id, connection);
  refusedRemotes.delete(contents.id);
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
    const connection = details.webContentsId == null ? null : connections.get(details.webContentsId);
    if (details.statusCode === 401 && connection && new URL(details.url).origin === connection.origin) {
      connection.watch.refused();
    }
  });
  const remotes = createRemotes({ appConfig, safeStorage, fetch });
  handle("instances:list", () => listLocalInstances({ configDir, readdir, call: callSocket }));
  handle("connection:connect", async (event, instance) =>
    adopt(event.sender, await connectLocal({ configDir, instance, call: callSocket })),
  );
  handle("connection:current", (event) => shown(connections.get(event.sender.id)) ?? null);
  handle("remotes:list", () => remotes.list());
  handle("remotes:connect", (event, form) => answer(async () => adopt(event.sender, await remotes.connect(form))));
  handle("remotes:connectSaved", (event, url) =>
    answer(async () => adopt(event.sender, await remotes.connectSaved(url))),
  );
  handle("remotes:forget", (_event, url) => remotes.forget(url));
  handle("remotes:refused", (event) => refusedRemotes.get(event.sender.id) ?? null);
}

app.whenReady().then(async () => {
  serveFrontend();
  serveConnections(await serveAppConfig());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the window quits the app.
app.on("window-all-closed", () => app.quit());
