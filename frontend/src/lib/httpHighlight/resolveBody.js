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

export const BODY_PREVIEW_BYTES = 256;

const TAG_UNCLOSED = -1;
const TAG_NESTED_OPEN = -2;

const HTML_TAGS = new Set([
  "html",
  "head",
  "body",
  "title",
  "meta",
  "link",
  "style",
  "script",
  "noscript",
  "div",
  "span",
  "p",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "label",
  "fieldset",
  "legend",
  "section",
  "main",
  "article",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "pre",
  "code",
  "blockquote",
  "img",
  "iframe",
  "video",
  "audio",
  "source",
  "canvas",
  "br",
  "hr",
  "center",
  "strong",
  "em",
  "small",
  "b",
  "i",
  "u",
]);

const XML_ROOT_TAGS = new Set(["svg", "rss", "feed", "plist", "urlset", "sitemapindex"]);

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const JSON_KEYWORD = /^(?:true|false|null)/;
const OPEN_TAG_START = /^<([A-Za-z][A-Za-z0-9:._-]*)(?=[\s/>])/;

function hasBinaryPrefix(preview) {
  const limit = Math.min(preview.length, BODY_PREVIEW_BYTES);
  for (let i = 0; i < limit; i++) {
    const code = preview.charCodeAt(i);
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f ||
      code === 0xfffd
    ) {
      return true;
    }
  }
  return false;
}

function skipWs(str, idx) {
  while (idx < str.length) {
    const code = str.charCodeAt(idx);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      idx++;
    } else {
      break;
    }
  }
  return idx;
}

function scanJsonStringEnd(str, start) {
  let i = start + 1;
  while (i < str.length) {
    const ch = str[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i++;
  }
  return -1;
}

function hasCleanJsonTail(trimmed, { requireClosed = false } = {}) {
  let depth = 0;
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '"') {
      const end = scanJsonStringEnd(trimmed, i);
      if (end < 0) return !requireClosed;
      i = end;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        const rest = trimmed.slice(i + 1);
        const afterWs = rest.trimStart();
        if (!afterWs) return true;
        // Allow NDJSON / JSON Lines (next JSON value on a new line)
        const leadingWs = rest.slice(0, rest.length - afterWs.length);
        return (
          (leadingWs.includes("\n") || leadingWs.includes("\r")) &&
          (afterWs[0] === "{" || afterWs[0] === "[")
        );
      }
    }
    i++;
  }
  return !requireClosed && depth > 0;
}

function looksLikeJsonValueStart(str, idx, depth) {
  idx = skipWs(str, idx);
  if (idx >= str.length) return false;
  const ch = str[idx];

  if (ch === "{") {
    const next = skipWs(str, idx + 1);
    if (next >= str.length) return false;
    if (str[next] === "}") return true;
    if (str[next] === '"') {
      const endStr = scanJsonStringEnd(str, next);
      if (endStr < 0) return true;
      const afterKey = skipWs(str, endStr);
      if (afterKey >= str.length) return false;
      return str[afterKey] === ":";
    }
    return false;
  }

  if (ch === "[") {
    const next = skipWs(str, idx + 1);
    if (next >= str.length) return false;
    if (str[next] === "]") return true;
    if (str[next] === "{" || str[next] === "[") {
      return depth >= 4 ? true : looksLikeJsonValueStart(str, next, depth + 1);
    }
    if (str[next] === '"') {
      const endStr = scanJsonStringEnd(str, next);
      if (endStr < 0) return true;
      const afterStr = skipWs(str, endStr);
      if (afterStr >= str.length) return false;
      return str[afterStr] === "," || str[afterStr] === "]";
    }
    const rest = str.slice(next);
    const num = JSON_NUMBER.exec(rest);
    if (num) {
      const afterNum = skipWs(str, next + num[0].length);
      if (afterNum >= str.length) return false;
      return str[afterNum] === "," || str[afterNum] === "]";
    }
    const kw = JSON_KEYWORD.exec(rest);
    if (kw) {
      const afterKw = skipWs(str, next + kw[0].length);
      if (afterKw >= str.length) return false;
      return str[afterKw] === "," || str[afterKw] === "]";
    }
    return false;
  }

  return false;
}

function looksLikeJson(trimmed, { requireClosedArray = false } = {}) {
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return false;
  const requireClosed = requireClosedArray && trimmed[0] === "[";
  return looksLikeJsonValueStart(trimmed, 0, 0) && hasCleanJsonTail(trimmed, { requireClosed });
}

function findTagClose(str, start) {
  let quote = "";
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "<") {
      return TAG_NESTED_OPEN;
    } else if (ch === ">") {
      return i;
    }
  }
  return TAG_UNCLOSED;
}

function sniffMarkup(trimmed, { strict = false } = {}) {
  let s = trimmed;
  while (s.startsWith("<!--")) {
    const endComment = s.indexOf("-->", 4);
    if (endComment < 0) return null;
    s = s.slice(endComment + 3).trimStart();
  }
  if (!s.startsWith("<")) return null;

  if (/^<!doctype\s+html(?:\s|>|$)/i.test(s)) return "html";
  if (/^<!doctype\s+[a-z]/i.test(s)) return "xml";
  if (/^<!doctype(?:\s|>|$)/i.test(s)) return "html";
  if (/^<\?xml(?:\s|\?>|$)/i.test(s)) return "xml";
  if (/^<html(?=[\s/>])/i.test(s)) return "html";

  if (strict) return null;

  const tagMatch = OPEN_TAG_START.exec(s);
  if (!tagMatch) return null;

  const tagName = tagMatch[1];
  const lower = tagName.toLowerCase();
  const afterName = tagMatch[0].length;
  const closeIdx = findTagClose(s, afterName);
  if (closeIdx === TAG_NESTED_OPEN) return null;

  const rawAttrs = (closeIdx >= 0 ? s.slice(afterName, closeIdx) : s.slice(afterName)).trim();
  const selfClosing = closeIdx >= 0 && rawAttrs.endsWith("/");
  const attrText = selfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs;
  const hasAttrEquals = attrText.includes("=");
  const afterTag = closeIdx >= 0 ? s.slice(closeIdx + 1) : "";
  const hasFollowingTag = /<\/[A-Za-z]|<[A-Za-z][A-Za-z0-9:._-]*(?=[\s/>])/.test(afterTag);

  // Reject unclosed tags without attribute syntax and prose like "<p is less than 5>"
  if (closeIdx < 0 && !hasAttrEquals) return null;
  if (attrText && !hasAttrEquals && !hasFollowingTag) {
    // Allow a single bare boolean attribute only on known HTML tags (e.g. "<input disabled>")
    if (!HTML_TAGS.has(lower) || /\s/.test(attrText)) return null;
  }

  if (!tagName.includes(":") && HTML_TAGS.has(lower)) {
    return "html";
  }

  if (
    XML_ROOT_TAGS.has(lower) ||
    tagName.includes(":") ||
    /\bxmlns(?::[A-Za-z0-9._-]+)?\s*=/.test(attrText) ||
    (selfClosing && hasAttrEquals) ||
    hasFollowingTag
  ) {
    return "xml";
  }

  return null;
}

/**
 * Resolves the body syntax format from the parsed head's Content-Type and a
 * leading preview of the body.
 */
export function resolveBodyFormat({ contentType, bodyPreview = "" } = {}) {
  const preview = typeof bodyPreview === "string" ? bodyPreview.slice(0, BODY_PREVIEW_BYTES) : "";
  if (hasBinaryPrefix(preview)) return null;

  const declared = formatFromContentType(contentType);
  const trimmed = preview.trim();

  if (declared) {
    if (!trimmed) return declared;
    if (declared === "json") {
      if (trimmed[0] === "<") {
        return sniffMarkup(trimmed) ?? declared;
      }
      return declared;
    }
    if (declared === "html" || declared === "xml") {
      if (trimmed[0] !== "<" && looksLikeJson(trimmed)) {
        return "json";
      }
      return declared;
    }
    // Declared js, css, or form: only override on unmistakable HTML, XML, or JSON signatures.
    // For JS, an unclosed leading array literal (`["<long>..."].forEach(...)`) is valid JS,
    // so only override arrays when they close cleanly inside the preview with no JS tail.
    if (trimmed[0] === "<") {
      return sniffMarkup(trimmed, { strict: true }) ?? declared;
    }
    if (looksLikeJson(trimmed, { requireClosedArray: declared === "js" })) {
      return "json";
    }
    return declared;
  }

  if (!trimmed) return null;
  if (looksLikeJson(trimmed)) return "json";
  if (trimmed[0] === "<") return sniffMarkup(trimmed);
  return null;
}
