// Content-Type classifier and conditional magic-byte / markup sniffer for
// HTTP response rendering. Pure JS so it loads under node --test.
import { parseMediaType, resolveBodyFormat } from "../httpHighlight/resolveBody.js";

const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function hasBytesAt(buf, offset, seq) {
  if (buf.length < offset + seq.length) return false;
  for (let i = 0; i < seq.length; i++) {
    if (buf[offset + i] !== seq[i]) return false;
  }
  return true;
}

function asciiAt(buf, offset, str) {
  if (buf.length < offset + str.length) return false;
  for (let i = 0; i < str.length; i++) {
    if (buf[offset + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

function sniffFtyp(buf) {
  if (buf.length < 12 || !asciiAt(buf, 4, "ftyp")) return null;
  const brands = [];
  const major = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  brands.push(major);
  const limit = Math.min(buf.length, 64);
  for (let i = 16; i + 4 <= limit; i += 4) {
    brands.push(String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]));
  }
  if (brands.some((b) => b === "avif" || b === "avis")) {
    return { kind: "image", mime: "image/avif", sniffed: true };
  }
  if (major === "M4A " || major === "M4B ") {
    return { kind: "audio", mime: "audio/mp4", sniffed: true };
  }
  if (
    brands.some((b) =>
      b === "mp41" ||
      b === "mp42" ||
      b === "isom" ||
      b === "iso2" ||
      b === "iso5" ||
      b === "iso6" ||
      b === "avc1" ||
      b === "M4V " ||
      b === "qt  " ||
      b === "dash" ||
      b === "msdh",
    )
  ) {
    return { kind: "video", mime: "video/mp4", sniffed: true };
  }
  return null;
}

function sniffOgg(buf) {
  if (!asciiAt(buf, 0, "OggS")) return null;
  const sample = new TextDecoder("latin1").decode(buf.subarray(0, Math.min(buf.length, 128)));
  if (sample.includes("theora") || sample.includes("VP80") || sample.includes("fishead")) {
    return { kind: "video", mime: "video/ogg", sniffed: true };
  }
  return { kind: "audio", mime: "audio/ogg", sniffed: true };
}

function sniffMagicBytes(buf) {
  // PNG
  if (hasBytesAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", mime: "image/png", sniffed: true };
  }
  // JPEG
  if (hasBytesAt(buf, 0, [0xff, 0xd8, 0xff])) {
    return { kind: "image", mime: "image/jpeg", sniffed: true };
  }
  // GIF
  if (asciiAt(buf, 0, "GIF87a") || asciiAt(buf, 0, "GIF89a")) {
    return { kind: "image", mime: "image/gif", sniffed: true };
  }
  // RIFF container: WebP or WAV
  if (asciiAt(buf, 0, "RIFF") && buf.length >= 12) {
    if (asciiAt(buf, 8, "WEBP")) return { kind: "image", mime: "image/webp", sniffed: true };
    if (asciiAt(buf, 8, "WAVE")) return { kind: "audio", mime: "audio/wav", sniffed: true };
  }
  // BMP (BM header + 4 reserved zero bytes at offset 6..9)
  if (buf.length >= 14 && asciiAt(buf, 0, "BM") && buf[6] === 0 && buf[7] === 0 && buf[8] === 0 && buf[9] === 0) {
    return { kind: "image", mime: "image/bmp", sniffed: true };
  }
  // ICO
  if (hasBytesAt(buf, 0, [0x00, 0x00, 0x01, 0x00]) && buf.length >= 6) {
    return { kind: "image", mime: "image/x-icon", sniffed: true };
  }
  // ISO BMFF (AVIF, MP4, MOV, M4A)
  const ftyp = sniffFtyp(buf);
  if (ftyp) return ftyp;
  // WebM / Matroska EBML
  if (hasBytesAt(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: "video", mime: "video/webm", sniffed: true };
  }
  // Ogg
  const ogg = sniffOgg(buf);
  if (ogg) return ogg;
  // FLAC
  if (asciiAt(buf, 0, "fLaC")) {
    return { kind: "audio", mime: "audio/flac", sniffed: true };
  }
  // MP3 (ID3 tag or MPEG frame sync)
  if (
    asciiAt(buf, 0, "ID3") ||
    (buf.length >= 4 &&
      buf[0] === 0xff &&
      (buf[1] & 0xe0) === 0xe0 &&
      (buf[1] & 0x18) !== 0x08 &&
      (buf[1] & 0x06) !== 0x00 &&
      (buf[2] & 0xf0) !== 0xf0)
  ) {
    return { kind: "audio", mime: "audio/mpeg", sniffed: true };
  }
  return null;
}

function hasControlBytes(buf) {
  const limit = Math.min(buf.length, 256);
  for (let i = 0; i < limit; i++) {
    const b = buf[i];
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) return true;
  }
  return false;
}

function sniffMarkupBytes(buf) {
  if (hasControlBytes(buf)) return null;
  const sample = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, Math.min(buf.length, 1024)));
  let trimmed = sample.replace(/^\uFEFF/, "").trimStart();
  if (!trimmed.startsWith("<")) return null;

  // Strip leading comments when checking for <svg or <?xml ... <svg
  let stripped = trimmed;
  while (stripped.startsWith("<!--")) {
    const end = stripped.indexOf("-->", 4);
    if (end < 0) return null;
    stripped = stripped.slice(end + 3).trimStart();
  }
  if (/^<svg(?=[\s/>])/i.test(stripped)) {
    return { kind: "svg", mime: "image/svg+xml", sniffed: true };
  }
  if (/^<\?xml\b/i.test(stripped)) {
    const afterXml = stripped.replace(/^<\?xml[\s\S]*?\?>/i, "").trimStart();
    if (/^(?:<!doctype\s+svg[^>]*>\s*)?<svg(?=[\s/>])/i.test(afterXml)) {
      return { kind: "svg", mime: "image/svg+xml", sniffed: true };
    }
  }
  if (resolveBodyFormat({ contentType: "", bodyPreview: trimmed }) === "html") {
    return { kind: "html", mime: "text/html", sniffed: true };
  }
  return null;
}

/**
 * Classifies a decoded HTTP response for rendering.
 * Specific Content-Type headers are trusted verbatim (nosniff semantics).
 * Sniffing runs only when Content-Type is missing or generic octet-stream.
 */
export function classifyResponse({ contentType = "", bodyBytes = null } = {}) {
  const mime = parseMediaType(contentType);

  if (!GENERIC_TYPES.has(mime)) {
    if (mime === "text/html" || mime === "application/xhtml+xml") {
      return { kind: "html", mime, sniffed: false };
    }
    if (mime === "image/svg+xml") {
      return { kind: "svg", mime, sniffed: false };
    }
    if (mime.startsWith("image/")) {
      return { kind: "image", mime, sniffed: false };
    }
    if (mime.startsWith("video/")) {
      return { kind: "video", mime, sniffed: false };
    }
    if (mime.startsWith("audio/")) {
      return { kind: "audio", mime, sniffed: false };
    }
    return { kind: "unsupported", mime, sniffed: false };
  }

  if (bodyBytes && bodyBytes.length > 0) {
    const binary = sniffMagicBytes(bodyBytes);
    if (binary) return binary;
    const markup = sniffMarkupBytes(bodyBytes);
    if (markup) return markup;
  }

  return { kind: "unsupported", mime: mime || "", sniffed: false };
}
