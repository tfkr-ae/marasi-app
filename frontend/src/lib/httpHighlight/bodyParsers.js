import { jsonLanguage } from "@codemirror/lang-json";
import { foldNodeProp, indentNodeProp, languageDataProp, sublanguageProp } from "@codemirror/language";
import { getStyleTags, styleTags, tags as t } from "@lezer/highlight";

const STRIP_CHROME_PROPS = [
  foldNodeProp.add(() => null),
  indentNodeProp.add(() => null),
  languageDataProp.add(() => null),
  sublanguageProp.add(() => null),
];

const hasInvalidTag = (tag) => tag.set.includes(t.invalid);

/**
 * Strips interactive editor chrome (folding, indentation, closeBrackets /
 * languageData) and any `tags.invalid` highlight rules from a Lezer LRParser
 * so body subtrees highlight permissively without injecting editor chrome.
 */
export function stripBodyParser(parser) {
  const invalidOverrides = Object.create(null);
  let hasOverrides = false;

  for (const type of parser.nodeSet.types) {
    if (!type.name || type.isAnonymous) continue;
    const rule = getStyleTags({ type, matchContext: () => true });
    if (!rule) continue;
    for (let cur = rule; cur; cur = cur.next) {
      if (cur.tags.some(hasInvalidTag)) {
        const clean = cur.tags.filter((tag) => !hasInvalidTag(tag));
        const key = /[\/!*]/.test(type.name) ? JSON.stringify(type.name) : type.name;
        invalidOverrides[key] = clean;
        hasOverrides = true;
        break;
      }
    }
  }

  const props = hasOverrides ? [...STRIP_CHROME_PROPS, styleTags(invalidOverrides)] : STRIP_CHROME_PROPS;
  return parser.configure({ props });
}

const BODY_PARSERS = {
  json: stripBodyParser(jsonLanguage.parser),
};

/** Returns the stripped Lezer Parser for a resolved body format, or null. */
export function bodyParserFor(format) {
  return format ? (BODY_PARSERS[format] ?? null) : null;
}
