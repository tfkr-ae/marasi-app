// Where a text form error Marasi names by line and column sits in the text,
// for MessageEditor.svelte's error marker. Pure JS, for `node --test`.

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
  for (const char of lines[Math.max(line - 1, 0)]) {
    if (bytes >= column - 1) break;
    bytes += encoder.encode(char).length;
    index += char.length;
  }
  return start + index;
}
