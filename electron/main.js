// The Electron main process. It draws the window and serves the static
// frontend build; it has no Marasi domain logic (see
// docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from "electron";
import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assetPath } from "./assets.js";
import { withBearer } from "./bearer.js";
import { connectLocal, listLocalInstances } from "./instances.js";
import { callSocket } from "./socket.js";

const here = dirname(fileURLToPath(import.meta.url));
// The frontend build is served on app://marasi/, so its absolute /_app/
// paths and the client router work as on a web server.
const scheme = "app";
const origin = `${scheme}://marasi`;
// `npm run dev` points the window at the Vite dev server instead.
const devServerURL = app.isPackaged ? null : process.env.MARASI_DEV_SERVER_URL;
const appOrigin = new URL(devServerURL ?? `${origin}/`).origin;
// Marasi's config directory, where its instances keep their sockets: the
// one Marasi itself defaults to (os.UserConfigDir()/Marasi), unless
// MARASI_CONFIG_DIR names another, as for a throwaway instance.
const configDir = process.env.MARASI_CONFIG_DIR || join(app.getPath("appData"), "Marasi");
// Each window's connection, by its webContents id: {instance, origin,
// token, loopbackTurnedOn}. The token stays here; the renderer gets the
// rest.
const connections = new Map();

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
  window.webContents.on("destroyed", () => connections.delete(id));
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
  handle("connection:connect", async (event, instance) => {
    const connection = await connectLocal({ configDir, instance, call: callSocket });
    connections.set(event.sender.id, connection);
    return shown(connection);
  });
  handle("connection:current", (event) => shown(connections.get(event.sender.id)) ?? null);
}

app.whenReady().then(() => {
  serveFrontend();
  serveConnections();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// As in v1, closing the window quits the app.
app.on("window-all-closed", () => app.quit());
