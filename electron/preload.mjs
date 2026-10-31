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
