// The local Chrome calls the renderer may make (localChrome.js), each on its
// own IPC channel `localChrome:<call>`, resolving { value } or { error } as
// the app config calls do. A remote's proxy address is keyed by the window's
// own connection, so a renderer can't read or change another remote's.

const configCalls = ["paths", "addPath", "removePath", "profiles", "addProfile", "removeProfile"];
const remoteCalls = ["proxyAddress", "setProxyAddress", "start"];

export const localChromeCalls = [...configCalls, ...remoteCalls];

/** `connectionOf(webContentsId)` is the window's connection, or null. */
export function handleLocalChrome(ipcMain, { localChrome, connectionOf }) {
  const calls = {
    proxyAddress: (origin) => localChrome.proxyAddress(origin),
    setProxyAddress: (origin, address) => localChrome.setProxyAddress(origin, address),
    start: (_origin, options) => localChrome.start(options),
  };
  for (const name of localChromeCalls) {
    ipcMain.handle(`localChrome:${name}`, async (event, ...args) => {
      try {
        if (configCalls.includes(name)) return { value: await localChrome[name](...args) };
        const connection = connectionOf(event.sender.id);
        if (!connection?.remote) throw new Error("This machine's Chrome is for a remote connection");
        return { value: await calls[name](connection.origin, ...args) };
      } catch (error) {
        return { error: error?.message ?? String(error) };
      }
    });
  }
}
