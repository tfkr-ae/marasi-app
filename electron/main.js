// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell, webContents } from "electron";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants, readFileSync, statSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { access, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { networkInterfaces, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createAppConfig } from "./appConfig.js";
import { createCertificateFile } from "./certificateFile.js";
import { createArtifactFile } from "./artifactFile.js";
import { createReportFile } from "./reportFile.js";
import { createCAFile } from "./caFile.js";
import { handleAppConfig } from "./appConfigIPC.js";
import { assetPath } from "./assets.js";
import { withBearer } from "./bearer.js";
import { readBuildInfo } from "./buildInfo.js";
import { marasiConfigDir } from "./configDir.js";
import { listLocalInstances } from "./instances.js";
import { createKeybindingFiles } from "./keybindingFiles.js";
import { createLocalConnections } from "./local.js";
import { createLocalChrome } from "./localChrome.js";
import { handleLocalChrome } from "./localChromeIPC.js";
import { bundledMarasi, createMarasiChoice, runsBundled } from "./marasiBin.js";
import { nodeFS } from "./nodeFS.js";
import { createRemotes } from "./remotes.js";
import { callSocket, streamSocket } from "./socket.js";
import { watchToken } from "./tokenWatch.js";
import { handleUpdates, updateEventChannel } from "./updateIPC.js";
import { defaultInstaller, locateInstall } from "./updater/installers.js";
import { createUpdateFetch, envProxyConfig } from "./updater/updateNet.js";
import { createUpdater } from "./updater/updater.js";
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
// The windows, for the Window menu, the ⌘K window list and the dock badge.
const windows = createWindowList({ connectionOf: (id) => connections.get(id) });
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

// The app config v1 and v2 share, the keybinding profile files, and the
// certificate and artifact files and clipboard, for every window.
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
  // A Logbook artifact, which the renderer read from its instance.
  const artifactFile = createArtifactFile({
    fs: nodeFS,
    home: app.getPath("home"),
    dialog: { save: async (options) => chosen(await show(dialog.showSaveDialog, options)) },
  });
  handle("artifact:save", (event, filename, bytes) => artifactFile.save(filename, bytes));
  // A Logbook report, which the renderer exported from its instance.
  const reportFile = createReportFile({
    fs: nodeFS,
    home: app.getPath("home"),
    dialog: { save: async (options) => chosen(await show(dialog.showSaveDialog, options)) },
  });
  handle("report:save", (event, filename, bytes) => reportFile.save(filename, bytes));
  // An upstream proxy's CA, read from a file on this machine.
  const caFile = createCAFile({
    fs: { readFile, stat },
    dialog: {
      open: async (options) => chosen(await show(dialog.showOpenDialog, { ...options, properties: ["openFile"] })),
    },
  });
  handle("upstreamProxy:readCAFile", () => caFile.read());
  handle("clipboard:writeText", (event, text) => clipboard.writeText(String(text)));
  handle("app:buildInfo", () => build);
  handle("app:userName", () => userInfo().username);
  // A config v2 can't prepare stays as it is; each read then reports why.
  await appConfig.load().catch((error) => console.error(`preparing ${configDir}:`, error));
  return appConfig;
}

// Starts `path` with `args` so that it outlives the app, as an installed
// update's relaunch and a started Chrome need.
function spawnDetached(path, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { detached: true, stdio: "ignore" });
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
    // Drafts live in the windows; runs in the instances, whose ticket adds
    // its warning.
    confirmLosingWork: async (action) => (draftsAgreed = await confirmLosingDrafts(action)),
    quit: () => app.quit(),
  });
  handleUpdates({ handle }, updater);
  updater.removeUpdateLeftovers();
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
    type: "radio",
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
  for (const window of BrowserWindow.getAllWindows()) {
    // A window closing, as at quit, can't be told.
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("windows:changed");
  }
}

// A window. A `blank` one opens on the connection screen, to connect to
// or start another instance, and one for `instance` connects to that
// running local instance, rather than on the default instance, a little
// below and right of the focused window.
function createWindow({ blank = false, instance = null } = {}) {
  const parent = BrowserWindow.getFocusedWindow();
  const offset = parent && (blank || instance) ? { x: parent.getBounds().x + 28, y: parent.getBounds().y + 28 } : {};
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
  if (blank || instance) connections.open(id, instance);
  windows.opened(id);
  window.webContents.on("destroyed", () => {
    connections.forget(id);
    unfollow(id);
    refusedRemotes.delete(id);
    windows.closed(id);
    windowsChanged();
  });
  // Closing a window loses its drafts; quitting has already asked.
  window.on("close", (event) => {
    const count = windows.drafts(id);
    if (stopping || !count) return;
    event.preventDefault();
    confirmLosingDrafts("Close window", count, window).then((close) => {
      if (!close || window.isDestroyed()) return;
      windows.setDrafts(id, 0);
      window.close();
    });
  });
  window.on("focus", () => Menu.setApplicationMenu(appMenu()));
  window.webContents.on("did-navigate", () => {
    windows.reloaded(id);
    windowsChanged();
  });
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
  windowsChanged();
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
      windows.disconnected(id);
      windowsChanged();
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
    const connection = await connections.startup(event.sender.id);
    const current = follow(event.sender);
    // After a reload: the loopback toast isn't shown again.
    return current && { ...current, resumed: Boolean(connection?.resumed) };
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
    windows.disconnected(event.sender.id);
    windowsChanged();
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
  // This machine's Chrome, which a remote connection's Start Chrome opens,
  // with its profiles' user-data-dirs in the config directory.
  const localChrome = createLocalChrome({
    appConfig,
    profilesDir: join(configDir, "v2_chrome_profiles"),
    isExecutable: (path) => access(path, fsConstants.X_OK).then(() => true, () => false),
    spawn: spawnDetached,
    removeDir: (path) => rm(path, { recursive: true, force: true }),
  });
  handleLocalChrome({ handle }, { localChrome, connectionOf: (id) => connections.get(id) });
  // The project a Start or an open opens, picked in an OS dialog: a path,
  // or null.
  handle("dialog:pick-project", async (event, title) => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: typeof title === "string" && title ? title : "Project to start",
      filters: [{ name: "Marasi project", extensions: ["marasi"] }],
      properties: ["openFile", "createDirectory", "promptToCreate"],
    });
    return picked.canceled ? null : picked.filePaths[0];
  });
  // One connection per window: another instance opens in a new window.
  handle("window:new", () => {
    createWindow({ blank: true });
  });
  // The running local instance that owns a locked project, in a new window.
  handle("window:open-instance", (event, instance) => {
    createWindow({ instance: String(instance) });
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
  handle("window:drafts", (event, count) => windows.setDrafts(event.sender.id, count));
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
  const appConfig = await serveAppConfig();
  serveConnections(appConfig);
  await serveUpdates(appConfig);
  createWindow();
  updater.startUpdateChecks();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the last window quits the app.
app.on("window-all-closed", () => app.quit());
// Quitting stops the update checks and the instances the app started and
// wasn't disconnected from, relaunches an installed update when quitting
// for "Restart now", then quits for real.
let stopping = false;
app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  const agreed = draftsAgreed;
  draftsAgreed = false;
  (agreed ? Promise.resolve(true) : confirmLosingDrafts("Quit Marasi")).then((quit) => {
    if (!quit || stopping) return;
    stopping = true;
    stopAndQuit();
  });
});

function stopAndQuit() {
  Promise.allSettled([updater?.stopUpdateChecks(), connections.quit()])
    .then(() => updater?.relaunchIfRestarting())
    .finally(() => app.quit());
}

// Whether the researcher just agreed to lose the drafts for a restart, so
// the quit it makes doesn't ask again.
let draftsAgreed = false;

// Asks before `action` ("Quit Marasi") loses `count` unsaved Launchpad
// drafts, by default every window's; they live only in the windows'
// memory. True with none.
async function confirmLosingDrafts(action, count = windows.drafts(), parent = BrowserWindow.getFocusedWindow()) {
  if (!count) return true;
  const options = {
    type: "warning",
    message: `${action}?`,
    detail: `${count === 1 ? "1 launchpad draft has" : `${count} launchpad drafts have`} unsaved edits, which will be discarded.`,
    buttons: [action, "Cancel"],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
  return response === 0;
}
