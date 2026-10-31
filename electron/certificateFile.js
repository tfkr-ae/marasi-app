// The instance's CA certificate, saved on this machine, as v1's DownloadCert
// did. The renderer reads the PEM from GET /certificate; the main process
// only chooses the file with a native save dialog and writes it.
import { join } from "node:path";

// When set, this file is used instead of the native save dialog, which tests
// and headless verification can't drive.
const certificateFileEnv = "MARASI_CERTIFICATE_FILE";

export const certificateFileFilters = [
  { name: "Certificate Files (*.crt)", extensions: ["crt"] },
  { name: "PEM Files (*.pem)", extensions: ["pem"] },
  { name: "All Files (*.*)", extensions: ["*"] },
];

/**
 * `dialog.save(options)` resolves the chosen path, or null when cancelled.
 * `fs` is node:fs/promises or a fake.
 */
export function createCertificateFile({ fs, dialog, env = process.env, home }) {
  return {
    /** Writes `pem` to a chosen file; returns its path, "" if cancelled. */
    async save(pem) {
      if (typeof pem !== "string") throw new Error("not a certificate");
      const path =
        env[certificateFileEnv] ||
        (await dialog.save({
          title: "Save Proxy Certificate",
          defaultPath: join(home, "Downloads", "marasi-proxy.crt"),
          filters: certificateFileFilters,
        }));
      if (!path) return "";
      await fs.writeFile(path, pem, { mode: 0o600 });
      return path;
    },
  };
}
