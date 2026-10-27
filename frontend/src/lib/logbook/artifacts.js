// How the Logbook previews an artifact, and the bytes behind it.
import { DownloadArtifact, GetArtifact } from "../wailsjs/go/main/App";

/** The largest artifact a record takes. */
export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

const TEXTUAL = /^(text\/|application\/(json|xml|yaml|x-yaml|har\+json|csv|javascript|x-ndjson))|\+json$|\+xml$/;
const TEXT_NAME = /\.(txt|log|json|har|csv|xml|ya?ml|md|html?|js|css)$/i;

/** How an artifact previews: "image", "video", "pdf", "text" or "other". */
export function previewKind(artifact) {
  const type = artifact?.MimeType ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf") return "pdf";
  if (TEXTUAL.test(type) || TEXT_NAME.test(artifact?.Filename ?? "")) return "text";
  return "other";
}

/** Text to show for an artifact's text: JSON and HAR pretty-printed. */
export function prettyText(artifact, text) {
  if (/json|har/.test(artifact?.MimeType ?? "") || /\.(json|har)$/i.test(artifact?.Filename ?? "")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

/** "12 KB" and the like. */
export function sizeText(bytes) {
  if (!(bytes >= 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The artifact's bytes as a Blob: a staged one's own File, or a stored one
 * read with GetArtifact (its Data arrives base64).
 */
export async function artifactBlob(artifact) {
  if (artifact.File) return artifact.File;
  const stored = await GetArtifact(artifact.ID);
  const bytes = Uint8Array.from(atob(stored.Data ?? ""), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: artifact.MimeType });
}

/** Saves a stored artifact through the native Save dialog; false when cancelled. */
export const downloadArtifact = (artifact) => DownloadArtifact(artifact.ID);
