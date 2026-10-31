// Keybinding profile files (docs/keybinding-profile-format.md), as in v1's
// keybinding_files.go. The renderer owns the format: it serializes the
// export and parses and checks an import. The main process only chooses the
// file with a native dialog and moves the text. Neither touches the app
// config; an imported profile is saved later with the keybindings.
import { basename, join } from "node:path";

// When set, this file is used instead of the native open or save dialog,
// which tests and headless verification can't drive.
const profileFileEnv = "MARASI_KEYBINDINGS_PROFILE_FILE";

// A profile with every action overridden on both platforms is a few tens of
// KiB.
const maxProfileFileSize = 1 << 20;

export const profileFileFilters = [
  { name: "Marasi Keybinding Profiles (*.json)", extensions: ["json"] },
  { name: "All Files (*.*)", extensions: ["*"] },
];

/**
 * `dialog.save(options)` and `dialog.open(options)` resolve the chosen path,
 * or null when cancelled. `fs` is node:fs/promises or a fake.
 */
export function createKeybindingFiles({ fs, dialog, env = process.env, home }) {
  return {
    /** Writes `contents` to a chosen file; returns its path, "" if cancelled. */
    async exportProfile(defaultName, contents) {
      const path =
        env[profileFileEnv] ||
        (await dialog.save({
          title: "Export Keybinding Profile",
          defaultPath: join(home, "Downloads", basename(String(defaultName))),
          filters: profileFileFilters,
        }));
      if (!path) return "";
      await fs.writeFile(path, String(contents), { mode: 0o600 });
      return path;
    },

    /** A chosen file's text, unparsed; path is "" if cancelled. */
    async importProfile() {
      const path =
        env[profileFileEnv] || (await dialog.open({ title: "Import Keybinding Profile", filters: profileFileFilters }));
      if (!path) return { path: "", contents: "" };
      const contents = await fs.readFile(path, "utf8");
      if (Buffer.byteLength(contents) > maxProfileFileSize) {
        throw new Error(`${basename(path)} is too large for a keybinding profile (over 1 MiB)`);
      }
      return { path, contents };
    },
  };
}
