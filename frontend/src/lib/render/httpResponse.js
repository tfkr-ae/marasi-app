// Binary-safe HTTP/1.1 & HTTP/2 text-form response head/body splitter and
// HTML charset decoder. Operates directly on Uint8Array so binary image/video/
// audio and compressed bodies are never corrupted by UTF-8 decoding.
import { parseMediaType } from "../httpHighlight/resolveBody.js";

const CR = 0x0d;
const LF = 0x0a;

/**
 * Finds the first header/body boundary in raw HTTP bytes: `\r\n\r\n`,
 * falling back to `\n\n` (for LF-only responses or Checkpoint edits).
 * Returns `{ headEnd, bodyStart }`, or `{ headEnd: bytes.length, bodyStart: bytes.length }`
 * when no delimiter is present.
 */
function findHeaderBodySplit(bytes) {
  let lfOnly = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (
      i + 3 < bytes.length &&
      bytes[i] === CR &&
      bytes[i + 1] === LF &&
      bytes[i + 2] === CR &&
      bytes[i + 3] === LF
    ) {
      return { headEnd: i, bodyStart: i + 4 };
    }
    if (lfOnly < 0 && i + 1 < bytes.length && bytes[i] === LF && bytes[i + 1] === LF) {
      lfOnly = i;
    }
  }
  if (lfOnly >= 0) {
    return { headEnd: lfOnly, bodyStart: lfOnly + 2 };
  }
  return { headEnd: bytes.length, bodyStart: bytes.length };
}

function parseCharset(contentTypeHeader) {
  if (!contentTypeHeader) return "";
  const match = /;\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentTypeHeader);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

/**
 * Splits raw HTTP response bytes into parsed metadata and a zero-copy
 * `bodyBytes` subarray. Handles both HTTP/1.1 (`HTTP/1.1 200 OK`) and
 * Marasi's HTTP/2 text form (`HTTP/2 200` + `:pseudo-headers`).
 */
export function parseRawResponse(rawBytes, { fallbackContentType = "", fallbackStatusCode = 0 } = {}) {
  if (!(rawBytes instanceof Uint8Array) || rawBytes.length === 0) {
    return {
      statusCode: Number(fallbackStatusCode) || 0,
      contentType: parseMediaType(fallbackContentType),
      charset: parseCharset(fallbackContentType),
      contentEncodings: [],
      headers: [],
      bodyBytes: new Uint8Array(0),
      hasHead: false,
    };
  }

  const { headEnd, bodyStart } = findHeaderBodySplit(rawBytes);
  const headText = new TextDecoder("latin1").decode(rawBytes.subarray(0, headEnd));
  const lines = headText.split(/\r?\n/);
  const firstLine = (lines[0] ?? "").trim();

  // Verify the first line is an HTTP response status line.
  const statusMatch = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3)\s+(\d{3})(?:\s|$)/i.exec(firstLine);
  if (!statusMatch) {
    // Headerless payload: treat entire bytes as body with fallback metadata.
    return {
      statusCode: Number(fallbackStatusCode) || 0,
      contentType: parseMediaType(fallbackContentType),
      charset: parseCharset(fallbackContentType),
      contentEncodings: [],
      headers: [],
      bodyBytes: rawBytes,
      hasHead: false,
    };
  }

  let statusCode = Number(statusMatch[1]) || Number(fallbackStatusCode) || 0;
  let contentTypeHeader = "";
  const contentEncodings = [];
  const headers = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Skip HTTP/2 pseudo-headers (`:status: 200`, etc.) except reading :status if needed.
    if (line.startsWith(":")) {
      const pseudoMatch = /^:status\s*:\s*(\d{3})/i.exec(line);
      if (pseudoMatch && !statusCode) statusCode = Number(pseudoMatch[1]);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const lower = name.toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers.push([lower, value]);

    if (lower === "content-type" && !contentTypeHeader) {
      contentTypeHeader = value;
    } else if (lower === "content-encoding") {
      for (const part of value.split(",")) {
        const coding = part.trim().toLowerCase();
        if (coding && coding !== "identity") {
          contentEncodings.push(coding);
        }
      }
    }
  }

  const effectiveContentType = contentTypeHeader || fallbackContentType;
  const bodyBytes = bodyStart < rawBytes.length ? rawBytes.subarray(bodyStart) : new Uint8Array(0);

  return {
    statusCode,
    contentType: parseMediaType(effectiveContentType),
    charset: parseCharset(effectiveContentType),
    contentEncodings,
    headers,
    bodyBytes,
    hasHead: true,
  };
}

function sniffHtmlMetaCharset(bytes) {
  const sample = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const direct = /<meta\b[^>]*\bcharset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'/>]+))/i.exec(sample);
  if (direct) return (direct[1] ?? direct[2] ?? direct[3] ?? "").trim();
  const equiv = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?content-type["']?[^>]*\bcontent\s*=\s*["']([^"']+)["']/i.exec(sample);
  if (equiv) return parseCharset(equiv[1]);
  return "";
}

/**
 * Decodes HTML bytes honoring explicit `charset`, falling back to `<meta charset>`
 * sniffing in the first 1024 ASCII bytes and then UTF-8.
 */
export function decodeHtmlText(bytes, { charset = "" } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return "";
  const label = (charset || sniffHtmlMetaCharset(bytes) || "utf-8").trim();
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}
