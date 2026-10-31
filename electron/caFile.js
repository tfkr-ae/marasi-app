// An upstream proxy's CA, read from a file on this machine, as v1's
// ReadUpstreamProxyCAFile did. The main process only picks the file with a
// native open dialog and reads its text; Marasi checks it when the renderer
// sends it as the entry's `ca`.
import { basename } from "node:path";

// When set, this file is read instead of showing the native open dialog,
// which tests and headless verification can't drive.
const caFileEnv = "MARASI_UPSTREAM_PROXY_CA_FILE";

/** The largest CA file read: a PEM bundle of a few hundred certificates fits. */
export const maxCAFileSize = 1 << 20;

export const caFileFilters = [
  { name: "Certificates (*.pem, *.crt, *.cer)", extensions: ["pem", "crt", "cer"] },
  { name: "All Files (*.*)", extensions: ["*"] },
];

/**
 * `dialog.open(options)` resolves the chosen path, or null when cancelled.
 * `fs` is node:fs/promises or a fake.
 */
export function createCAFile({ fs, dialog, env = process.env }) {
  return {
    /** The text of a chosen CA file, "" if cancelled. */
    async read() {
      const path = env[caFileEnv] || (await dialog.open({ title: "Choose a CA Certificate", filters: caFileFilters }));
      if (!path) return "";
      if ((await fs.stat(path)).size > maxCAFileSize) {
        throw new Error(`${basename(path)} is too large for a CA certificate (over 1 MiB)`);
      }
      return (await fs.readFile(path)).toString("utf8");
    },
  };
}
