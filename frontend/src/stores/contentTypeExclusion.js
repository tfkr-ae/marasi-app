// The content-type exclusion: the content types the Ledger, its counts, the
// sitemap and saved-query counts leave out. The app default lives in the
// app config (a Go binding); a project that edits its list keeps its own in
// the client setting `ledger.exclusion`, and otherwise follows the default
// (docs/adr/2026-10-16-app-defaults-with-project-overrides.md).
//
// The service applies no exclusion by itself, so every traffic read passes
// the project's effective list as `exclude`. It is read once and kept until
// a write or `forget()` (a project switch or a resync), so reads don't each
// cost a settings call.
import { normalizeContentType } from "../lib/ledger/contentTypes.js";
import { createClientSettings } from "./clientSettingsApi.js";

/** The project setting that holds the project's own exclusion. */
export const EXCLUSION_KEY = "ledger.exclusion";

/** Lowercased, without parameters, deduplicated: as Marasi stores it. */
export function normalizeExclusion(types) {
  return [...new Set((types ?? []).map(normalizeContentType).filter(Boolean))];
}

/**
 * The exclusion over `client`, with the app default from `appConfig`
 * (`getDefaultExclusion()`, `setDefaultExclusion(types)`).
 */
export function createExclusion(client, appConfig) {
  const settings = createClientSettings(client);
  // A promise of { types, own }, or null until read.
  let cached = null;

  async function load() {
    const setting = await settings.get(EXCLUSION_KEY);
    if (setting) {
      if (!Array.isArray(setting.value)) throw new Error(`${EXCLUSION_KEY} is not a list of content types`);
      return { types: setting.value, own: true };
    }
    return { types: (await appConfig.getDefaultExclusion()) ?? [], own: false };
  }

  function read() {
    if (!cached) {
      const reading = load();
      cached = reading;
      reading.catch(() => {
        if (cached === reading) cached = null;
      });
    }
    return cached;
  }

  return {
    /** The project's effective exclusion: its own list, or the app default. */
    effective: async () => [...(await read()).types],
    /** True when the project keeps its own list, false when it follows the default. */
    hasOwn: async () => (await read()).own,
    /** Gives the project its own list. */
    async set(types) {
      const list = normalizeExclusion(types);
      await settings.set(EXCLUSION_KEY, list);
      cached = Promise.resolve({ types: list, own: true });
    },
    /** Drops the project's own list, so it follows the app default. */
    async reset() {
      await settings.delete(EXCLUSION_KEY);
      cached = null;
    },
    getDefault: async () => (await appConfig.getDefaultExclusion()) ?? [],
    async setDefault(types) {
      await appConfig.setDefaultExclusion(normalizeExclusion(types));
      cached = null;
    },
    /** Reads the project's list afresh on next use. */
    forget() {
      cached = null;
    },
  };
}
