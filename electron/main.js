// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, webContents } from "electron";
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createAppConfig } from "./appConfig.js";
import { handleAppConfig } from "./appConfigIPC.js";
import { assetPath } from "./assets.js";
import { withBearer } from "./bearer.js";
import { marasiConfigDir } from "./configDir.js";
import { listLocalInstances } from "./instances.js";
import { createKeybindingFiles } from "./keybindingFiles.js";
import { createLocalConnections } from "./local.js";
import { bundledMarasi, createMarasiChoice } from "./marasiBin.js";
import { nodeFS } from "./nodeFS.js";
import { callSocket } from "./socket.js";
import { createWindowList } from "./windows.js";

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
// The windows, for the Window menu, the ⌘K window list and the dock badge.
const windows = createWindowList({ connectionOf: (id) => connections.get(id) });
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
  handle("app:buildInfo", () => ({ Channel: buildChannel, Version: app.getVersion() }));
  // A config v2 can't prepare stays as it is; each read then reports why.
  return appConfig.load().catch((error) => console.error(`preparing ${configDir}:`, error));
}

// The window with webContents id `id`, or null once it has closed.
function windowOf(id) {
  const contents = webContents.fromId(id);
  return contents ? BrowserWindow.fromWebContents(contents) : null;
}

function focusWindow(id) {
  const window = windowOf(id);
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

// The application menu, its Window menu listing the connected windows
// with the focused one checked.
function appMenu() {
  const mac = process.platform === "darwin";
  const focused = BrowserWindow.getFocusedWindow()?.webContents.id ?? null;
  const connected = windows.list(focused).map((item) => ({
    label: item.label,
    type: "checkbox",
    checked: item.current,
    click: () => focusWindow(item.id),
  }));
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        ...(mac ? [{ role: "zoom" }] : []),
        { type: "separator" },
        { label: "New Window", click: () => createWindow({ blank: true }) },
        ...(connected.length ? [{ type: "separator" }, ...connected] : []),
        { type: "separator" },
        mac ? { role: "front" } : { role: "close" },
      ],
    },
  ]);
}

// After a window opens, closes, connects, disconnects, opens a project or
// changes its held count: the Window menu, the dock badge and each
// renderer's window list follow.
function windowsChanged() {
  Menu.setApplicationMenu(appMenu());
  app.setBadgeCount(windows.held());
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("windows:changed");
}

// A window. A `blank` one opens on the connection screen, to connect to
// or start another instance, rather than on the default instance, a
// little below and right of the focused window.
function createWindow({ blank = false } = {}) {
  const parent = BrowserWindow.getFocusedWindow();
  const offset = parent && blank ? { x: parent.getBounds().x + 28, y: parent.getBounds().y + 28 } : {};
  const window = new BrowserWindow({
    title: "Marasi",
    width: 1600,
    height: 900,
    ...offset,
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
  if (blank) connections.open(id);
  windows.opened(id);
  window.webContents.on("destroyed", () => {
    connections.forget(id);
    windows.closed(id);
    windowsChanged();
  });
  window.on("focus", () => Menu.setApplicationMenu(appMenu()));
  window.loadURL(home);
  windowsChanged();
  return window;
}

// The connection a renderer may see: everything but the token.
const shown = (connection) =>
  connection && {
    instance: connection.instance,
    baseURL: connection.origin,
    loopbackTurnedOn: connection.loopbackTurnedOn,
    resumed: connection.resumed ?? false,
  };

// Runs `connecting`, a call that may change window `id`'s connection, and
// tells the windows when it has.
async function connecting(id, connect) {
  try {
    return shown(await connect());
  } finally {
    windowsChanged();
  }
}

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
  handle("connection:startup", (event) => connecting(event.sender.id, () => connections.startup(event.sender.id)));
  handle("connection:connect", (event, instance) =>
    connecting(event.sender.id, () => connections.connect(event.sender.id, instance)),
  );
  handle("connection:start", (event, { instance, project }) =>
    connecting(event.sender.id, () => connections.start(event.sender.id, { instance, project: project || null })),
  );
  handle("connection:disconnect", (event) => {
    connections.disconnect(event.sender.id);
    windows.disconnected(event.sender.id);
    windowsChanged();
  });
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
  // One connection per window: another instance opens in a new window.
  handle("window:new", () => {
    createWindow({ blank: true });
  });
  handle("windows:list", (event) => windows.list(event.sender.id));
  handle("window:focus", (event, id) => focusWindow(id));
  handle("window:project", (event, project) => {
    windows.setProject(event.sender.id, project);
    windowsChanged();
  });
  handle("window:held", (event, count) => {
    windows.setHeld(event.sender.id, count);
    windowsChanged();
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
  await serveAppConfig();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the last window quits the app.
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
