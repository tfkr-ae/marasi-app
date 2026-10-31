// The v1 bindings for the app config and keybinding profile files, which
// the main process owns (electron/appConfig.js). They reach it through the
// preload's `marasiApp.appConfig` bridge, where each call resolves
// { value } or { error }.
import { createCatalog } from "../keybindings/catalog.js";
import { settleProfile, validateProfile } from "../keybindings/profiles.js";
import { normalizeExclusion } from "../ledger/contentTypes.js";

/** A refusal from the main process. Shown as its message, as Wails errors were. */
export class AppConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppConfigError";
  }

  toString() {
    return this.message;
  }
}

// Checks every profile against the catalog the Settings page sent, and
// settles them, as v1's SaveKeybindings did before it wrote. The main
// process then checks the section's structure.
function checkedKeybindings(config, descriptor) {
  try {
    const catalog = createCatalog(descriptor.actions, { contexts: descriptor.contexts });
    const problems = config.profiles.flatMap((profile) => validateProfile(catalog, profile));
    if (problems.length) throw new Error(problems.map((problem) => problem.message).join("; "));
    return { ...config, profiles: config.profiles.map((profile) => settleProfile(catalog, profile)) };
  } catch (error) {
    throw new AppConfigError(`invalid keybindings: ${error.message}`);
  }
}

/** The bindings, calling the bridge `bridge()` returns. */
export function createAppConfigBindings(bridge) {
  async function call(name, ...args) {
    const calls = bridge();
    if (!calls) throw new AppConfigError("the app config needs the Marasi app window");
    const reply = await calls[name](...args);
    if (reply?.error) throw new AppConfigError(reply.error);
    return reply?.value;
  }

  return {
    GetMarasiConfig: () => call("marasiConfig"),
    SetFlag: (name, value) => call("setFlag", name, value),
    ToggleFlag: (name) => call("toggleFlag", name),

    GetKeybindings: () => call("keybindings"),
    SaveKeybindings: async (config, catalog) => call("saveKeybindings", checkedKeybindings(config, catalog)),
    ExportKeybindingProfile: (defaultName, contents) => call("exportProfile", defaultName, contents),
    ImportKeybindingProfile: () => call("importProfile"),

    GetHighlights: () => call("highlights"),
    SaveHighlights: (highlights) => call("saveHighlights", highlights),
    ResetHighlights: () => call("resetHighlights"),
    // v1's one-time move of old highlights is dropped (the parity table).
    MigrateOldHighlights: async () => ({ Ran: false, Highlighted: 0, Cleared: 0 }),

    GetAppSavedQueries: () => call("appSavedQueries"),
    SaveAppSavedQueries: (queries) => call("saveAppSavedQueries", queries),
    SetHiddenBuiltinQueries: (ids) => call("setHiddenBuiltinQueries", ids),

    GetDefaultContentTypeExclusion: () => call("defaultContentTypeExclusion"),
    SetDefaultContentTypeExclusion: async (values) => {
      let normalized;
      try {
        normalized = normalizeExclusion(values);
      } catch (error) {
        throw new AppConfigError(error.message);
      }
      return call("setDefaultContentTypeExclusion", normalized);
    },
  };
}
