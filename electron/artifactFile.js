// An artifact, saved on this machine, as v1's DownloadArtifact did. The
// renderer reads the bytes from GET /artifact/{id}/content; the main process
// only chooses the file with a native save dialog and writes it.
import { basename, join } from "node:path";

// When set, artifacts are saved in this directory under their own names
// instead of through the native save dialog, which tests and headless
// verification can't drive.
const artifactDirEnv = "MARASI_ARTIFACT_DIR";

/**
 * `dialog.save(options)` resolves the chosen path, or null when cancelled.
 * `fs` is node:fs/promises or a fake.
 */
export function createArtifactFile({ fs, dialog, env = process.env, home }) {
  return {
    /** Writes `bytes` to a chosen file; returns its path, "" if cancelled. */
    async save(filename, bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error("an artifact is saved from its bytes");
      // As v1, only the name's last part, so a name can't choose the directory.
      const name = basename(String(filename)) || "artifact";
      const path = env[artifactDirEnv]
        ? join(env[artifactDirEnv], name)
        : await dialog.save({ title: "Save Artifact", defaultPath: join(home, "Downloads", name) });
      if (!path) return "";
      await fs.writeFile(path, bytes, { mode: 0o600 });
      return path;
    },
  };
}
