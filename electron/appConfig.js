// The app config, marasi_appconfig.yaml in Marasi's config directory, which
// v1 and v2 share. Every read goes to the file, so a change v1 or another
// window made is seen, and every write patches only its own key (see
// configFile.js). Values keep the shape v1 reads.
import { join } from "node:path";
import { parse } from "yaml";
import { createConfigFile } from "./configFile.js";
import { factoryKeybindings, keybindingsKey, readKeybindings, toConfigKeybindings } from "./keybindings.js";

export const appConfigName = "marasi_appconfig.yaml";

// v1's flat preferences and their defaults (config.go configDefaults).
// ToggleFlag takes the boolean ones, SetFlag the text ones.
const flagDefaults = {
  first_run: true,
  vim_enabled: true,
  default_address: "127.0.0.1",
  default_port: "8080",
  syntax_mode: "auto",
  wrap_mode: "auto",
  text_size: "default",
};

// The exclusion every project followed before it moved to the app
// (content_type_exclusion.go seededContentTypeExclusion).
export const contentTypeExclusionKey = "ledger_content_type_exclusion";
const seededContentTypeExclusion = [
  "audio/aac", "image/apng", "image/avif", "video/x-msvideo", "image/bmp",
  "audio/midi", "audio/x-midi", "image/gif", "image/vnd.microsoft.icon",
  "image/jpeg", "audio/mpeg", "video/mp4", "video/mpeg", "audio/ogg",
  "video/ogg", "image/png", "image/svg+xml", "image/tiff", "video/mp2t",
  "audio/wav", "audio/webm", "video/webm", "image/webp", "video/3gpp",
  "audio/3gpp", "video/3gpp2", "audio/3gpp2", "application/vnd.ms-fontobject",
  "font/otf", "font/ttf", "font/woff", "font/woff2", "application/x-abiword",
  "application/vnd.amazon.ebook", "application/x-cdf", "application/x-csh",
  "application/epub+zip", "application/vnd.apple.installer+xml",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text", "application/vnd.visio",
  "application/vnd.mozilla.xul+xml", "application/javascript",
  "application/octet-stream", "binary/octet-stream", "image/x-icon",
  "image/vnd.djvu", "image/x-portable-pixmap", "image/x-portable-bitmap",
  "audio/basic", "audio/aiff", "audio/x-aiff", "audio/x-wav",
  "audio/x-mpegurl", "audio/x-ms-wma", "video/quicktime", "video/x-flv",
  "video/x-ms-wmv", "application/pdf", "application/msword",
  "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf", "application/x-rar-compressed",
  "application/x-7z-compressed", "application/zip", "application/x-tar",
  "application/gzip", "application/x-font-ttf", "application/x-font-woff",
  "text/css", "text/calendar", "text/vcard", "application/x-shockwave-flash",
  "application/x-bzip", "application/x-bzip2",
];

// Highlight numbers 1 to 8, in order: v1's colours, with no labels.
export const highlightsKey = "highlights";
const defaultHighlightColors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"];

const testCasesName = "test_cases.yml";

function isBooleanFlag(name) {
  return typeof flagDefaults[name] === "boolean";
}

function isTextFlag(name) {
  return typeof flagDefaults[name] === "string";
}

// Reads a flag as v1's viper does: a missing key is its default, and a
// boolean written as text still reads as a boolean.
function flagValue(values, name) {
  const value = values[name] ?? flagDefaults[name];
  if (isBooleanFlag(name)) return value === true || String(value).toLowerCase() === "true" || value === 1;
  return String(value);
}

// Go's runtime.GOOS for an Electron platform, as v1 reported DesktopOS.
function desktopOS(platform) {
  return platform === "win32" ? "windows" : platform;
}

/**
 * The app config in `dir`. `fs` is node:fs/promises or a fake with the same
 * readFile, writeFile, rename, rm and mkdir.
 */
export function createAppConfig({ dir, fs, platform = process.platform, defaultTestCases = "" }) {
  const file = createConfigFile({ path: join(dir, appConfigName), fs });
  const testCasesPath = join(dir, testCasesName);
  // Writes run one at a time, so two windows can't interleave a read and a
  // write of the same file.
  let queue = Promise.resolve();
  function serialized(work) {
    const run = queue.then(work);
    queue = run.catch(() => {});
    return run;
  }

  // The Logbook's test case templates (v1 loadTestCases), as v1 sent them.
  async function testCaseProfile() {
    let profile = {};
    try {
      profile = parse(await fs.readFile(testCasesPath, "utf8")) ?? {};
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const text = (value) => (value == null ? "" : String(value));
    return {
      Title: text(profile.title),
      Description: text(profile.description),
      Version: text(profile.version),
      TestCases: (Array.isArray(profile.test_cases) ? profile.test_cases : []).map((testCase) => ({
        Title: text(testCase?.title),
        Description: text(testCase?.description),
        Category: text(testCase?.category),
      })),
    };
  }

  // The flat preferences in the shape v1's GetMarasiConfig returned.
  async function marasiConfig() {
    const values = await file.values();
    return {
      ConfigDir: dir,
      DesktopOS: desktopOS(platform),
      FirstRun: flagValue(values, "first_run"),
      VimEnabled: flagValue(values, "vim_enabled"),
      DefaultAddress: flagValue(values, "default_address"),
      DefaultPort: flagValue(values, "default_port"),
      SyntaxMode: flagValue(values, "syntax_mode"),
      WrapMode: flagValue(values, "wrap_mode"),
      TextSize: flagValue(values, "text_size"),
      TestCaseProfile: await testCaseProfile(),
    };
  }

  return {
    marasiConfig,

    /**
     * Prepares the config dir as v1's LoadConfig does: adds the preferences,
     * keybindings, default exclusion and highlights that are missing, and
     * writes test_cases.yml from the default when there is none. A key
     * already in the file, even one v2 can't read, is never rewritten.
     */
    load() {
      return serialized(async () => {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const values = await file.values();
        const seeds = {
          ...flagDefaults,
          [keybindingsKey]: toConfigKeybindings(factoryKeybindings()),
          [contentTypeExclusionKey]: seededContentTypeExclusion,
          [highlightsKey]: defaultHighlightColors.map((color) => ({ color })),
        };
        const missing = Object.fromEntries(Object.entries(seeds).filter(([key]) => !(key in values)));
        if (Object.keys(missing).length) await file.write(missing);
        try {
          await fs.readFile(testCasesPath, "utf8");
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
          await fs.writeFile(testCasesPath, defaultTestCases, { mode: 0o600 });
        }
      });
    },

    /** The saved keybinding profiles as { config, problem } (v1 GetKeybindings). */
    async keybindings() {
      return readKeybindings((await file.values())[keybindingsKey]);
    },

    /**
     * Writes the whole keybindings section. The renderer has already checked
     * it against the action catalog and settled it; this refuses a section
     * that breaks its structure, leaving the file unchanged.
     */
    saveKeybindings(config) {
      return serialized(async () => {
        let section;
        try {
          section = toConfigKeybindings(config);
        } catch (error) {
          throw new Error(`invalid keybindings: ${error.message}`);
        }
        await file.write({ [keybindingsKey]: section });
        return readKeybindings(section);
      });
    },

    /** Flips the switch preference `name`; returns the preferences. */
    toggleFlag(name) {
      return serialized(async () => {
        if (!isBooleanFlag(name)) throw new Error(`toggling flag : ${name} is not a switch`);
        await file.write({ [name]: !flagValue(await file.values(), name) });
        return marasiConfig();
      });
    },

    /** Sets the text preference `name` to `value`; returns the preferences. */
    setFlag(name, value) {
      return serialized(async () => {
        if (!isTextFlag(name)) throw new Error(`setting flag : ${name} is not a text preference`);
        await file.write({ [name]: String(value) });
        return marasiConfig();
      });
    },
  };
}
