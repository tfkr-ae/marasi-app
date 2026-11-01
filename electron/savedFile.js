// Bytes the renderer read from its instance, saved on this machine as v1
// saved them: a native save dialog offering the name in Downloads. The main
// process only chooses the file and writes it.
import { basename, join } from "node:path";

/**
 * A save of one kind of file. `title` heads the dialog, `fallback` names a
 * file whose name is empty, and when `env[dirEnv]` is set files are saved in
 * that directory under their own names instead of through the dialog, which
 * tests and headless verification can't drive. `filters`, when given, are
 * the dialog's file types. `dialog.save(options)` resolves the chosen path,
 * or null when cancelled; `fs` is node:fs/promises or a fake.
 */
export function createSavedFile({ fs, dialog, env = process.env, home, title, dirEnv, fallback, filters }) {
  return {
    /** Writes `bytes` to a chosen file; returns its path, "" if cancelled. */
    async save(filename, bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error(`${fallback} is saved from its bytes`);
      // As v1, only the name's last part, so a name can't choose the directory.
      const name = basename(String(filename)) || fallback;
      const path = env[dirEnv]
        ? join(env[dirEnv], name)
        : await dialog.save({ title, defaultPath: join(home, "Downloads", name), ...(filters && { filters }) });
      if (!path) return "";
      await fs.writeFile(path, bytes, { mode: 0o600 });
      return path;
    },
  };
}
