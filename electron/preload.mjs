// The bridge between the main process and the renderer. The renderer shows
// hostile captured content, so it gets only what is exposed here.
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("marasiApp", {
  platform: process.platform,
});
