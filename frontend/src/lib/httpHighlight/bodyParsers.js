import { jsonLanguage } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xmlLanguage } from "@codemirror/lang-xml";
import { cssLanguage } from "@codemirror/lang-css";
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { indentNodeProp, languageDataProp, sublanguageProp } from "@codemirror/language";
import { getStyleTags, styleTags, tags as t } from "@lezer/highlight";
import { formUrlEncodedParser } from "./formParser.js";

const STRIP_CHROME_PROPS = [
  indentNodeProp.add(() => null),
  languageDataProp.add(() => null),
  sublanguageProp.add(() => null),
];

const hasInvalidTag = (tag) => tag.set.includes(t.invalid);
const formatSegment = (name) => (!name ? "*" : /[\/!* "]/.test(name) ? JSON.stringify(name) : name);

/**
 * Strips auto-indentation and languageData (closeBrackets, extra completions)
 * plus any `tags.invalid` highlight rules from a Lezer LRParser so body
 * subtrees highlight permissively and support native code folding without
 * injecting editing chrome.
 */
export function stripBodyParser(parser) {
  const invalidOverrides = Object.create(null);
  let hasOverrides = false;

  for (const type of parser.nodeSet.types) {
    if (!type.name || type.isAnonymous) continue;
    const rule = getStyleTags({ type, matchContext: () => true });
    if (!rule) continue;
    for (let cur = rule; cur; cur = cur.next) {
      if (!cur.tags.some(hasInvalidTag)) continue;
      const clean = cur.tags.filter((tag) => !hasInvalidTag(tag));
      const prefix = cur.context ? `${cur.context.map(formatSegment).join("/")}/` : "";
      const suffix = cur.inherit ? "/..." : cur.opaque ? "!" : "";
      const key = `${prefix}${formatSegment(type.name)}${suffix}`;
      invalidOverrides[key] = clean;
      hasOverrides = true;
    }
  }

  const props = hasOverrides ? [...STRIP_CHROME_PROPS, styleTags(invalidOverrides)] : STRIP_CHROME_PROPS;
  return parser.configure({ props });
}

const strippedJs = stripBodyParser(javascriptLanguage.parser);
const strippedTs = stripBodyParser(typescriptLanguage.parser);
const strippedJsx = stripBodyParser(jsxLanguage.parser);
const strippedTsx = stripBodyParser(tsxLanguage.parser);
const strippedJsonExpr = strippedJs.configure({ top: "SingleExpression" });
const strippedCss = stripBodyParser(cssLanguage.parser);
const strippedCssStyles = strippedCss.configure({ top: "Styles" });

const HTML_EVENT_ATTRS = (
  "beforeunload copy cut dragstart dragover dragleave dragenter dragend " +
  "drag paste focus blur change click load mousedown mouseenter mouseleave " +
  "mouseup keydown keyup resize scroll unload"
)
  .split(" ")
  .map((name) => ({ name: `on${name}`, parser: strippedJs }));

const strippedHtml = stripBodyParser(
  html({
    nestedLanguages: [
      {
        tag: "script",
        attrs: (attrs) => attrs.type == "text/typescript" || attrs.lang == "ts",
        parser: strippedTs,
      },
      {
        tag: "script",
        attrs: (attrs) => attrs.type == "text/babel" || attrs.type == "text/jsx",
        parser: strippedJsx,
      },
      {
        tag: "script",
        attrs: (attrs) => attrs.type == "text/typescript-jsx",
        parser: strippedTsx,
      },
      {
        tag: "script",
        attrs: (attrs) => /^(importmap|speculationrules|application\/(.+\+)?json)$/i.test(attrs.type),
        parser: strippedJsonExpr,
      },
      {
        tag: "script",
        attrs: (attrs) =>
          !attrs.type || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^module$|^$/i.test(attrs.type),
        parser: strippedJs,
      },
      {
        tag: "style",
        attrs: (attrs) =>
          (!attrs.lang || attrs.lang == "css") && (!attrs.type || /^(text\/)?(x-)?(stylesheet|css)$/i.test(attrs.type)),
        parser: strippedCss,
      },
    ],
    nestedAttributes: [{ name: "style", parser: strippedCssStyles }, ...HTML_EVENT_ATTRS],
  }).language.parser,
);

const BODY_PARSERS = {
  json: stripBodyParser(jsonLanguage.parser),
  html: strippedHtml,
  xml: stripBodyParser(xmlLanguage.parser),
  js: strippedJs,
  css: strippedCss,
  form: formUrlEncodedParser,
};

/** Returns the stripped Lezer Parser for a resolved body format, or null. */
export function bodyParserFor(format) {
  return format ? (BODY_PARSERS[format] ?? null) : null;
}
