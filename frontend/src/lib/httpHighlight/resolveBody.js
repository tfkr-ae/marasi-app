/** Extracts the normalized lower-case media type (type/subtype) without parameters. */
export function parseMediaType(contentType) {
  if (!contentType || typeof contentType !== "string") return "";
  const semi = contentType.indexOf(";");
  const raw = (semi >= 0 ? contentType.slice(0, semi) : contentType).trim().toLowerCase();
  return raw;
}

/** Maps a Content-Type header value to a supported body format key, or null. */
export function formatFromContentType(contentType) {
  const mediaType = parseMediaType(contentType);
  if (!mediaType) return null;
  if (mediaType === "application/json" || mediaType === "text/json") return "json";
  const slash = mediaType.indexOf("/");
  if (slash > 0 && mediaType.endsWith("+json") && mediaType.length > slash + "+json".length + 1) {
    return "json";
  }
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") return "html";
  if (mediaType === "application/xml" || mediaType === "text/xml") return "xml";
  if (slash > 0 && mediaType.endsWith("+xml") && mediaType.length > slash + "+xml".length + 1) {
    return "xml";
  }
  if (
    mediaType === "text/javascript" ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-javascript"
  ) {
    return "js";
  }
  if (mediaType === "text/css") return "css";
  if (mediaType === "application/x-www-form-urlencoded") return "form";
  return null;
}

/**
 * Resolves the body syntax format from the parsed head's Content-Type and a
 * leading preview of the body. Extended in later tickets with binary guard,
 * contradiction checks, and prefix sniffing.
 */
export function resolveBodyFormat({ contentType }) {
  return formatFromContentType(contentType);
}
