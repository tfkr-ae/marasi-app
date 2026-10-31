// The bridge between the main process and the renderer. The renderer shows
// hostile captured content, so it gets only what is exposed here.
import { contextBridge, ipcRenderer } from "electron";
import { appConfigCalls } from "./appConfigIPC.js";

contextBridge.exposeInMainWorld("marasiApp", {
  platform: process.platform,
  // The app config calls; each resolves { value } or { error }.
  appConfig: Object.fromEntries(
    appConfigCalls.map((name) => [name, (...args) => ipcRenderer.invoke(`appConfig:${name}`, ...args)]),
  ),
});
