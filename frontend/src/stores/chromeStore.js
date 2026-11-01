// The Chrome paths and profiles, wired to the Chrome bindings
// (createChromeStore.js has the logic).
import { createChromeStore } from "./createChromeStore.js";
import {
  AddChromePath,
  AddChromeProfile,
  DeleteChromePath,
  DeleteChromeProfile,
  GetChromePaths,
  GetChromeProfiles,
} from "../lib/bindings/App";
import { isRemoteConnection } from "../lib/bindings/marasi.js";

export const chromeStore = createChromeStore({
  paths: GetChromePaths,
  profiles: GetChromeProfiles,
  addPath: AddChromePath,
  removePath: DeleteChromePath,
  addProfile: AddChromeProfile,
  removeProfile: DeleteChromeProfile,
  instanceChrome: () => !isRemoteConnection(),
});
