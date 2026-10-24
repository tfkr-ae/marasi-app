// The app's upstream proxy store, bound to the Wails backend. The logic
// lives in createUpstreamProxyStore.js, which tests load with a fake API.
import {
  AddUpstreamProxy,
  CheckUpstreamProxy,
  GetUpstreamProxies,
  ReadUpstreamProxyCAFile,
  RemoveUpstreamProxy,
  UpdateUpstreamProxy,
  UseUpstreamProxy,
} from "../lib/wailsjs/go/main/App";
import { createUpstreamProxyStore } from "./createUpstreamProxyStore.js";

export {
  selectionWarning,
  upstreamAddress,
} from "./createUpstreamProxyStore.js";

export const upstreamProxyStore = createUpstreamProxyStore({
  list: () => GetUpstreamProxies(),
  add: (name, url, ca) => AddUpstreamProxy(name, url, ca),
  update: (name, url, ca, removeCA) =>
    UpdateUpstreamProxy(name, url, ca, removeCA),
  remove: (name) => RemoveUpstreamProxy(name),
  use: (name) => UseUpstreamProxy(name),
  check: (name, target) => CheckUpstreamProxy(name, target),
});

/** Asks for a CA file and resolves to its text, or "" when cancelled. */
export const readUpstreamProxyCAFile = () => ReadUpstreamProxyCAFile();
