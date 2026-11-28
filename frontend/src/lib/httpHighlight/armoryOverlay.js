import { StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

const CHAIN_FUNCTIONS = new Set([
  "upper",
  "lower",
  "reverse",
  "trim",
  "base64",
  "hex",
  "sha256",
  "urlencode",
  "pathescape",
  "raw",
]);

const markerMark = Decoration.mark({ class: "cm-armory-marker" });
const chainMark = Decoration.mark({ class: "cm-armory-chain" });
const templateMark = Decoration.mark({ class: "cm-armory-template" });

function isIdentChar(code) {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

/**
 * Finds the index just past the matching closing `@@` starting at `from`,
 * respecting `\\` and `\@` escapes as in Marasi's `armory/templates.go`.
 * Returns -1 if unclosed.
 */
function findClosingMarker(text, from) {
  const len = text.length;
  for (let i = from; i < len; ) {
    const ch = text.charCodeAt(i);
    if (ch === 92 /* \ */ && i + 1 < len) {
      const next = text.charCodeAt(i + 1);
      if (next === 92 /* \ */ || next === 64 /* @ */) {
        i += 2;
        continue;
      }
    }
    if (ch === 64 /* @ */ && i + 1 < len && text.charCodeAt(i + 1) === 64) {
      return i + 2;
    }
    i++;
  }
  return -1;
}

/**
 * Scans valid chained `.fn()` calls immediately after a closing `@@`, appending
 * decoration ranges to `ranges` and returning the index after the last valid call.
 */
function scanFunctionChain(text, start, ranges) {
  const len = text.length;
  let i = start;
  while (i < len && text.charCodeAt(i) === 46 /* . */) {
    const nameStart = i + 1;
    let nameEnd = nameStart;
    while (nameEnd < len && isIdentChar(text.charCodeAt(nameEnd))) nameEnd++;
    if (
      nameEnd === nameStart ||
      nameEnd + 1 >= len ||
      text.charCodeAt(nameEnd) !== 40 /* ( */ ||
      text.charCodeAt(nameEnd + 1) !== 41 /* ) */
    ) {
      break;
    }
    const name = text.slice(nameStart, nameEnd);
    if (!CHAIN_FUNCTIONS.has(name)) break;
    const callEnd = nameEnd + 2;
    ranges.push(chainMark.range(i, callEnd));
    i = callEnd;
  }
  return i;
}

/**
 * Finds the index just past the closing `}}` of a Go `text/template` action
 * starting right after `{{`, respecting double-quoted strings, rune literals,
 * backtick raw strings (e.g. `` {{`{{`}} ``), and `/* ... *\/` comments.
 * Returns -1 if unclosed.
 */
function findClosingTemplateAction(text, from) {
  const len = text.length;
  for (let i = from; i < len; ) {
    const ch = text.charCodeAt(i);
    if (ch === 34 /* " */ || ch === 39 /* ' */) {
      const quote = ch;
      i++;
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 92 /* \ */ && i + 1 < len) {
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        if (c === 10 /* \n */) break;
        i++;
      }
      continue;
    }
    if (ch === 96 /* ` */) {
      const closeTick = text.indexOf("`", i + 1);
      if (closeTick < 0) return -1;
      i = closeTick + 1;
      continue;
    }
    if (ch === 47 /* / */ && i + 1 < len && text.charCodeAt(i + 1) === 42 /* * */) {
      const closeComment = text.indexOf("*/", i + 2);
      if (closeComment < 0) return -1;
      i = closeComment + 2;
      continue;
    }
    if (ch === 125 /* } */ && i + 1 < len && text.charCodeAt(i + 1) === 125) {
      return i + 2;
    }
    i++;
  }
  return -1;
}

function buildArmoryDecorations(doc) {
  const text = doc.toString();
  const len = text.length;
  const ranges = [];
  let noMoreMarkers = false;
  let noMoreActions = false;

  for (let i = 0; i < len; ) {
    const ch = text.charCodeAt(i);
    if (ch === 92 /* \ */ && i + 1 < len) {
      const next = text.charCodeAt(i + 1);
      if (next === 92 /* \ */ || next === 64 /* @ */) {
        i += 2;
        continue;
      }
    }

    if (!noMoreMarkers && ch === 64 /* @ */ && i + 1 < len && text.charCodeAt(i + 1) === 64) {
      const closeEnd = findClosingMarker(text, i + 2);
      if (closeEnd > 0) {
        ranges.push(markerMark.range(i, closeEnd));
        i = scanFunctionChain(text, closeEnd, ranges);
        continue;
      }
      noMoreMarkers = true;
      i += 2;
      continue;
    }

    if (!noMoreActions && ch === 123 /* { */ && i + 1 < len && text.charCodeAt(i + 1) === 123) {
      const closeEnd = findClosingTemplateAction(text, i + 2);
      if (closeEnd > 0) {
        ranges.push(templateMark.range(i, closeEnd));
        i = closeEnd;
        continue;
      }
      if (text.indexOf("}}", i + 2) < 0) noMoreActions = true;
      i += 2;
      continue;
    }

    i++;
  }

  return Decoration.set(ranges);
}

const armoryDecorationsField = StateField.define({
  create(state) {
    return buildArmoryDecorations(state.doc);
  },
  update(value, tr) {
    return tr.docChanged ? buildArmoryDecorations(tr.state.doc) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const armoryOverlayTheme = EditorView.baseTheme({
  "&light .cm-armory-marker, &light .cm-armory-marker *": {
    color: "#9a3412",
  },
  "&light .cm-armory-marker": {
    backgroundColor: "rgba(245, 158, 11, 0.18)",
    fontWeight: "600",
  },
  "&dark .cm-armory-marker, &dark .cm-armory-marker *": {
    color: "#fbbf24",
  },
  "&dark .cm-armory-marker": {
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    fontWeight: "600",
  },
  "&light .cm-armory-chain, &light .cm-armory-chain *": {
    color: "#0f766e",
  },
  "&light .cm-armory-chain": {
    backgroundColor: "rgba(20, 184, 166, 0.14)",
    fontWeight: "600",
  },
  "&dark .cm-armory-chain, &dark .cm-armory-chain *": {
    color: "#2dd4bf",
  },
  "&dark .cm-armory-chain": {
    backgroundColor: "rgba(45, 212, 191, 0.14)",
    fontWeight: "600",
  },
  "&light .cm-armory-template, &light .cm-armory-template *": {
    color: "#6d28d9",
  },
  "&light .cm-armory-template": {
    backgroundColor: "rgba(139, 92, 246, 0.14)",
    fontWeight: "600",
  },
  "&dark .cm-armory-template, &dark .cm-armory-template *": {
    color: "#c084fc",
  },
  "&dark .cm-armory-template": {
    backgroundColor: "rgba(192, 132, 252, 0.16)",
    fontWeight: "600",
  },
});

/** CodeMirror extensions that highlight Armory payload markers and template syntax. */
export const armoryOverlayExtensions = [armoryDecorationsField, armoryOverlayTheme];
