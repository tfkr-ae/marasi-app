import { Language, defineLanguageFacet } from "@codemirror/language";
import { HttpParser, bodyMetaProp, createHeadNodeSet } from "./httpHighlight/headParser.js";
import { bodyParserFor } from "./httpHighlight/bodyParsers.js";
import { resolveBodyFormat } from "./httpHighlight/resolveBody.js";

/** Bodies at least this long skip body highlighting under the "auto" syntax mode. */
export const SYNTAX_AUTO_LIMIT = 75_000;

const BODY_PREVIEW_BYTES = 256;

const httpData = defineLanguageFacet();
const headNodeSet = createHeadNodeSet(httpData);

function createHttpLanguage(bodyLimit) {
  const nest = (node, input) => {
    if (node.name !== "Body") return null;
    const bodyLength = node.to - node.from;
    if (bodyLength <= 0 || bodyLength >= bodyLimit) return null;
    const meta = node.node.tree?.prop(bodyMetaProp);
    const contentType = meta?.contentType ?? "";
    const previewEnd = Math.min(node.to, node.from + BODY_PREVIEW_BYTES);
    const bodyPreview = input.read(node.from, previewEnd);
    const format = resolveBodyFormat({ contentType, bodyPreview });
    const parser = bodyParserFor(format);
    return parser ? { parser } : null;
  };
  return new Language(httpData, new HttpParser(headNodeSet, nest), [], "http");
}

const autoLanguage = createHttpLanguage(SYNTAX_AUTO_LIMIT);
const enabledLanguage = createHttpLanguage(Infinity);

/**
 * Returns CodeMirror extensions for HTTP syntax highlighting under `mode`
 * ("auto" | "enabled" | "disabled" | undefined).
 *
 * - "disabled" or undefined: highlights nothing (`[]`).
 * - "auto": always highlights the HTTP head; skips body highlighting once the
 *   body reaches SYNTAX_AUTO_LIMIT (75,000 characters).
 * - "enabled": highlights both head and body regardless of length.
 */
export function httpHighlighting({ mode } = {}) {
  if (mode === "auto") return [autoLanguage];
  if (mode === "enabled") return [enabledLanguage];
  return [];
}
