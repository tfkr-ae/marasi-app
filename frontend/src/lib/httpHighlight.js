import { Language, defineLanguageFacet } from "@codemirror/language";
import { HttpParser, bodyMetaProp, createHeadNodeSet } from "./httpHighlight/headParser.js";
import { bodyParserFor } from "./httpHighlight/bodyParsers.js";
import { BODY_PREVIEW_BYTES, resolveBodyFormat } from "./httpHighlight/resolveBody.js";
import { armoryOverlay } from "./httpHighlight/armoryOverlay.js";
import { framedBodyParserFor, isMessageFraming } from "./httpHighlight/framedBodyParser.js";

/** Bodies at least this long skip body highlighting under the "auto" syntax mode. */
export const SYNTAX_AUTO_LIMIT = 75_000;

const httpData = defineLanguageFacet();
const headNodeSet = createHeadNodeSet(httpData);

function createHttpLanguage(bodyLimit, { armory = false, framed = false } = {}) {
  const nest = (node, input) => {
    if (node.name !== "Body") return null;
    const bodyLength = node.to - node.from;
    if (bodyLength <= 0 || bodyLength >= bodyLimit) return null;
    const meta = node.node.tree?.prop(bodyMetaProp);
    const contentType = meta?.contentType ?? "";
    if (framed) {
      return { parser: framedBodyParserFor(contentType) };
    }
    const previewEnd = Math.min(node.to, node.from + BODY_PREVIEW_BYTES);
    const bodyPreview = input.read(node.from, previewEnd);
    const format = resolveBodyFormat({ contentType, bodyPreview });
    const parser = bodyParserFor(format);
    return parser ? { parser } : null;
  };
  return new Language(httpData, new HttpParser(headNodeSet, nest, { armory }), [], "http");
}

const autoLanguage = createHttpLanguage(SYNTAX_AUTO_LIMIT);
const enabledLanguage = createHttpLanguage(Infinity);
const autoArmoryLanguage = createHttpLanguage(SYNTAX_AUTO_LIMIT, { armory: true });
const enabledArmoryLanguage = createHttpLanguage(Infinity, { armory: true });
const autoFramedLanguage = createHttpLanguage(SYNTAX_AUTO_LIMIT, { armory: true, framed: true });
const enabledFramedLanguage = createHttpLanguage(Infinity, { armory: true, framed: true });

/**
 * Returns CodeMirror extensions for HTTP syntax highlighting under `mode`
 * ("auto" | "enabled" | "disabled" | undefined).
 *
 * - "disabled" or undefined: highlights nothing (`[]`).
 * - "auto": always highlights the HTTP head; skips body highlighting once the
 *   body reaches SYNTAX_AUTO_LIMIT (75,000 characters).
 * - "enabled": highlights both head and body regardless of length.
 *
 * When `armory` is true, adds Armory template overlay decorations (`@@...@@`
 * markers with chained functions and Go `text/template` `{{...}}` actions),
 * and when `framing` is `"grpc"`, `"grpc-web"`, or `"connect"`, parses framed
 * message-form bodies as Protobuf text form or JSON by Content-Type.
 */
export function httpHighlighting({ mode, armory = false, framing = "" } = {}) {
  const isAuto = mode === "auto";
  if (!isAuto && mode !== "enabled") return [];

  if (!armory) return [isAuto ? autoLanguage : enabledLanguage];

  const framed = isMessageFraming(framing);
  const language = framed
    ? isAuto
      ? autoFramedLanguage
      : enabledFramedLanguage
    : isAuto
      ? autoArmoryLanguage
      : enabledArmoryLanguage;
  return [language, ...armoryOverlay(isAuto ? SYNTAX_AUTO_LIMIT : Infinity)];
}
