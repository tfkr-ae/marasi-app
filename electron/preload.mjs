// The bridge between the main process and the renderer. The renderer shows
// hostile captured content, so it gets only what is exposed here. A
// connection reaches the renderer without its control token.
import { contextBridge, ipcRenderer } from "electron";
import { appConfigCalls } from "./appConfigIPC.js";
import { updateCalls, updateEventChannel } from "./updateIPC.js";

contextBridge.exposeInMainWorld("marasiApp", {
  platform: process.platform,
  // The app's own build: { Channel, Version }.
  buildInfo: () => ipcRenderer.invoke("app:buildInfo"),
  // The service instances running on this machine, each its /service/status.
  listInstances: () => ipcRenderer.invoke("instances:list"),
  // A connection is {instance, baseURL, loopbackTurnedOn, remote}, and
  // startup marks one it takes up after a reload `resumed`.
  // At launch: the default instance, started on the scratchpad if it isn't
  // running; after a reload, the window's connection; after a disconnect, null.
  startup: () => ipcRenderer.invoke("connection:startup"),
  // Connects this window to running local `instance`.
  connect: (instance) => ipcRenderer.invoke("connection:connect", instance),
  // Starts local `instance` on `project` (a path, or null for the
  // scratchpad) and connects this window to it.
  start: (instance, project) => ipcRenderer.invoke("connection:start", { instance, project }),
  // Ends this window's connection, leaving its instance running.
  disconnect: () => ipcRenderer.invoke("connection:disconnect"),
  // This window's connection, or null.
  connection: () => ipcRenderer.invoke("connection:current"),
  // A new window on the connection screen, to connect to or start another
  // instance: each window has one connection.
  newWindow: () => ipcRenderer.invoke("window:new"),
  // The connected windows: [{id, instance, project, label, current}],
  // `current` marking this one.
  windows: () => ipcRenderer.invoke("windows:list"),
  // Brings window `id` to the front.
  focusWindow: (id) => ipcRenderer.invoke("window:focus", id),
  // Calls `listener` whenever the windows change; returns the call that stops.
  onWindowsChanged: (listener) => {
    const changed = () => listener();
    ipcRenderer.on("windows:changed", changed);
    return () => ipcRenderer.off("windows:changed", changed);
  },
  // This window's open project's name, for the window list.
  reportProject: (project) => ipcRenderer.invoke("window:project", project),
  // This window's Checkpoint held count, for the dock badge.
  reportHeld: (count) => ipcRenderer.invoke("window:held", count),
  // The saved remote instances: [{name, url}].
  listRemotes: () => ipcRenderer.invoke("remotes:list"),
  // Connects this window to the remote at `url` with `token`, saving it
  // under `name` when `save` is set. Resolves { value: connection }, or
  // { error, tokenRefused, remote }.
  connectRemote: ({ url, token, name, save }) => ipcRenderer.invoke("remotes:connect", { url, token, name, save }),
  // Connects this window to the saved remote at `url`, answering as connectRemote.
  connectSaved: (url) => ipcRenderer.invoke("remotes:connectSaved", url),
  forgetRemote: (url) => ipcRenderer.invoke("remotes:forget", url),
  // The remote whose refused token brought this window back to the
  // connection screen, {name, url}, or null.
  refusedRemote: () => ipcRenderer.invoke("remotes:refused"),
  // A project picked in an OS dialog: its path, or null.
  pickProject: () => ipcRenderer.invoke("dialog:pick-project"),
  // The Marasi Start runs: {path, bundled}, path null for the bundled one.
  marasi: () => ipcRenderer.invoke("marasi:current"),
  // Whether a local instance's build path (GET /update's install_path) is
  // the bundled Marasi.
  runsBundled: (installPath) => ipcRenderer.invoke("marasi:runs-bundled", installPath),
  // Chooses a Marasi from a path in an OS dialog, or the bundled one when
  // `bundled`. Resolves to the Marasi Start runs, as marasi() does.
  chooseMarasi: (bundled = false) => ipcRenderer.invoke("marasi:choose", { bundled }),
  // The app's own updater calls; each resolves { value } or { error }.
  updates: Object.fromEntries(updateCalls.map((name) => [name, (...args) => ipcRenderer.invoke(`update:${name}`, ...args)])),
  // Calls `callback(name, payload)` for each updater event (update-available,
  // update-progress, update-installed, update-failed); returns its removal.
  onUpdateEvent(callback) {
    const listener = (_event, name, payload) => callback(name, payload);
    ipcRenderer.on(updateEventChannel, listener);
    return () => ipcRenderer.removeListener(updateEventChannel, listener);
  },
  // Saves the instance's CA certificate `pem` through a save dialog; resolves
  // the path, or "" if cancelled.
  saveCertificate: (pem) => ipcRenderer.invoke("certificate:save", pem),
  // Puts `text` on this machine's clipboard.
  copyText: (text) => ipcRenderer.invoke("clipboard:writeText", text),
  // The app config calls; each resolves { value } or { error }.
  appConfig: Object.fromEntries(
    appConfigCalls.map((name) => [name, (...args) => ipcRenderer.invoke(`appConfig:${name}`, ...args)]),
  ),
});
