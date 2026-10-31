// The bridge between the main process and the renderer. The renderer shows
// hostile captured content, so it gets only what is exposed here. A
// connection reaches the renderer without its control token.
import { contextBridge, ipcRenderer } from "electron";
import { appConfigCalls } from "./appConfigIPC.js";

contextBridge.exposeInMainWorld("marasiApp", {
  platform: process.platform,
  // The app's own build: { Channel, Version }.
  buildInfo: () => ipcRenderer.invoke("app:buildInfo"),
  // The service instances running on this machine, each its /service/status.
  listInstances: () => ipcRenderer.invoke("instances:list"),
  // Connects this window to local `instance`: {instance, baseURL, loopbackTurnedOn}.
  connect: (instance) => ipcRenderer.invoke("connection:connect", instance),
  // This window's connection, or null.
  connection: () => ipcRenderer.invoke("connection:current"),
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
  // The app config calls; each resolves { value } or { error }.
  appConfig: Object.fromEntries(
    appConfigCalls.map((name) => [name, (...args) => ipcRenderer.invoke(`appConfig:${name}`, ...args)]),
  ),
});
