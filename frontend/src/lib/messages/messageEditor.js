// The message editor's text error marker (MessageEditor.svelte): where a
// text form error Marasi names by line and column sits in the text, and the
// CodeMirror extension that marks that line and place.
import { StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/**
 * The offset in `text` of `line` and `column`, both 1-based with the column
 * counted in UTF-8 bytes as Marasi counts it, kept inside the text.
 */
export function markerOffset(text, line, column) {
  const lines = text.split("\n");
  if (line > lines.length) return text.length;
  const start = lines.slice(0, Math.max(line - 1, 0)).reduce((sum, l) => sum + l.length + 1, 0);
  const encoder = new TextEncoder();
  let bytes = 0;
  let index = 0;
  const current = lines[Math.max(line - 1, 0)];
  for (const char of current) {
    if (bytes >= column - 1) break;
    bytes += encoder.encode(char).length;
    index += char.length;
  }
  return start + index;
}

const errorLine = Decoration.line({ class: "cm-message-error-line" });
const errorMark = Decoration.mark({ class: "cm-message-error-mark" });

const theme = EditorView.baseTheme({
  ".cm-message-error-line": { backgroundColor: "rgba(220, 38, 38, 0.12)" },
  ".cm-message-error-mark": { textDecoration: "underline wavy rgb(220, 38, 38)" },
});

/**
 * The extension marking `marker` ({ line, column }) in the text the editor
 * opens with, or none without one. A new marker makes a new extension.
 */
export function errorMarker(marker) {
  if (!marker?.line) return [];
  const field = StateField.define({
    create(state) {
      const text = state.doc.toString();
      const at = markerOffset(text, marker.line, marker.column ?? 1);
      const line = state.doc.lineAt(at);
      const end = Math.min(at + 1, line.to);
      const ranges = [errorLine.range(line.from)];
      if (end > at) ranges.push(errorMark.range(at, end));
      return Decoration.set(ranges, true);
    },
    update: (decorations, tr) => decorations.map(tr.changes),
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, theme];
}
