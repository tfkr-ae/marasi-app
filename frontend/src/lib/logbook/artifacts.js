// How the Logbook previews an artifact: by its content type, or by its file
// name's extension when the type says nothing useful, with its bytes read
// from GetArtifact's base64.

const TEXT_TYPE = /^text\/|json|xml|yaml|csv|javascript|\bhar\b/;
const TEXT_EXT = new Set(["txt", "log", "md", "json", "har", "csv", "xml", "yaml", "yml", "html", "htm", "js"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "ogv"]);

const extensionOf = (name) => {
  const at = (name ?? "").lastIndexOf(".");
  return at < 0 ? "" : name.slice(at + 1).toLowerCase();
};

function byType(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (TEXT_TYPE.test(mime)) return "text";
  return null;
}

function byExtension(ext) {
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXT.has(ext)) return "text";
  return "file";
}

/**
 * How an artifact ({ MimeType, Filename }) previews: "image", "video",
 * "pdf", "text", or "file" for a Download card.
 */
export const previewOf = (artifact) =>
  byType((artifact?.MimeType ?? "").toLowerCase()) ?? byExtension(extensionOf(artifact?.Filename));

/** An artifact's bytes from GetArtifact's Data: Go's []byte as base64, or a list of numbers. */
export function artifactBytes(data) {
  if (data == null) return new Uint8Array();
  if (typeof data !== "string") return Uint8Array.from(data);
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

const isJson = (artifact) =>
  /json|\bhar\b/.test((artifact?.MimeType ?? "").toLowerCase()) ||
  ["json", "har"].includes(extensionOf(artifact?.Filename));

/** A text artifact's bytes as text, JSON and HAR pretty-printed. */
export function artifactText(bytes, artifact) {
  const text = new TextDecoder().decode(bytes);
  if (!isJson(artifact)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A size in bytes as "512 B", "2 KB" or "1.5 MB". */
export function formatSize(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The largest file a record takes as an artifact. */
export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
