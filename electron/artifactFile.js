// An artifact, saved on this machine, as v1's DownloadArtifact did. The
// renderer reads the bytes from GET /artifact/{id}/content.
import { createSavedFile } from "./savedFile.js";

/** MARASI_ARTIFACT_DIR saves there without the dialog. */
export const createArtifactFile = (options) =>
  createSavedFile({ ...options, title: "Save Artifact", dirEnv: "MARASI_ARTIFACT_DIR", fallback: "artifact" });
