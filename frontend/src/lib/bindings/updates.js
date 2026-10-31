// The v1 updater bindings, which the main process's updater answers
// (electron/updater/updater.js). They reach it through the preload's
// `marasiApp.updates` bridge, where each call resolves { value } or
// { error }, and return v1's shapes.

/** A refusal from the updater, shown as its message, as Wails errors were. */
export class UpdateError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpdateError";
  }

  toString() {
    return this.message;
  }
}

/** The bindings, calling the bridge `bridge()` returns. */
export function createUpdateBindings(bridge) {
  const call = (name) => async (...args) => {
    const calls = bridge();
    if (!calls) throw new UpdateError("updates need the Marasi app window");
    const reply = await calls[name](...args);
    if (reply?.error) throw new UpdateError(reply.error);
    return reply?.value;
  };
  return {
    GetUpdateState: call("getUpdateState"),
    CheckForUpdate: call("checkForUpdate"),
    InstallUpdate: call("installUpdate"),
    CancelUpdateDownload: call("cancelUpdateDownload"),
    RestartToUpdate: call("restartToUpdate"),
    ReinstallLatestRelease: call("reinstallLatestRelease"),
    DismissUpdate: call("dismissUpdate"),
    SetUpdateChannel: call("setUpdateChannel"),
    GetUpdateSettings: call("getUpdateSettings"),
    SetAutomaticUpdateChecks: call("setAutomaticUpdateChecks"),
  };
}
