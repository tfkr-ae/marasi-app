// The bridge between the main process and the renderer. The renderer shows
// hostile captured content, so it gets only what is exposed here. A
// connection reaches the renderer without its control token.
import { contextBridge, ipcRenderer } from "electron";
import { appConfigCalls } from "./appConfigIPC.js";

contextBridge.exposeInMainWorld("marasiApp", {
  platform: process.platform,
  // The service instances running on this machine, each its /service/status.
  listInstances: () => ipcRenderer.invoke("instances:list"),
  // Connects this window to local `instance`: {instance, baseURL, loopbackTurnedOn}.
  connect: (instance) => ipcRenderer.invoke("connection:connect", instance),
  // This window's connection, or null.
  connection: () => ipcRenderer.invoke("connection:current"),
  // The app config calls; each resolves { value } or { error }.
  appConfig: Object.fromEntries(
    appConfigCalls.map((name) => [name, (...args) => ipcRenderer.invoke(`appConfig:${name}`, ...args)]),
  ),
});
