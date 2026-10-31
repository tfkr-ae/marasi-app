// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAppConfig } from "./appConfig.js";
import { handleAppConfig } from "./appConfigIPC.js";
import { assetPath } from "./assets.js";
import { marasiConfigDir } from "./configDir.js";
import { createKeybindingFiles } from "./keybindingFiles.js";
import { nodeFS } from "./nodeFS.js";

const here = dirname(fileURLToPath(import.meta.url));
// The frontend build is served on app://marasi/, so its absolute /_app/
// paths and the client router work as on a web server.
const scheme = "app";
const origin = `${scheme}://marasi`;
// `npm run dev` points the window at the Vite dev server instead.
const devServerURL = app.isPackaged ? null : process.env.MARASI_DEV_SERVER_URL;

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

const configDir = marasiConfigDir({
  appData: app.getPath("appData"),
  configDirSwitch: app.commandLine.getSwitchValue("config-dir"),
});

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
  handleAppConfig(ipcMain, { appConfig, keybindingFiles });
  // A config v2 can't prepare stays as it is; each read then reports why.
  return appConfig.load().catch((error) => console.error(`preparing ${configDir}:`, error));
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
  const appOrigin = new URL(home).origin;
  // Links that leave the app open in the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== appOrigin) event.preventDefault();
  });
  window.loadURL(home);
  return window;
}

app.whenReady().then(async () => {
  serveFrontend();
  await serveAppConfig();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the window quits the app.
app.on("window-all-closed", () => app.quit());
