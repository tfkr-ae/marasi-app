// Whether an editor wraps a body's lines, from the Wrap lines toggle and the
// Line wrapping setting ("auto", "enabled" or "disabled"). CodeMirror lays a
// wrapped line out again on every measure, and while an editor opens on a
// line of a few hundred kilobytes (a base64 file in a JSON response) those
// layouts block the page for seconds. So "auto", like "auto" syntax
// highlighting, leaves such a line unwrapped: CodeMirror draws only the
// visible part of an unwrapped line. "enabled" wraps it anyway, and
// "disabled" starts the toggle off. Editors that fold long strings
// (longStrings.js) count only the line left showing; the compare view, which
// does not fold, uses wrapsLines.

/** Under "auto", bodies with a line longer than this are not wrapped. */
export const WRAP_LINE_LIMIT = 100_000;

/** The tooltip text for an editor that is not wrapping because of a long line. */
export const WRAP_SUSPENDED = "Not wrapped: a shown line is over 100,000 characters. Settings › Line wrapping › Enabled wraps it anyway.";

function hasLongLine(text) {
  if (text.length <= WRAP_LINE_LIMIT) return false;
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    if (end - start > WRAP_LINE_LIMIT) return true;
    start = end + 1;
  }
  return false;
}

/**
 * Whether an editor showing `body` wraps its lines while the Wrap lines
 * toggle is `wrap`, under the Line wrapping setting `mode`. Before the
 * settings load, it stops at the limit as "auto" does.
 */
export function wrapsLines(body, wrap, mode) {
  if (!wrap) return false;
  if (mode === "enabled") return true;
  return !hasLongLine(body ?? "");
}

/** Whether the Wrap lines toggle starts on under the Line wrapping setting. */
export function wrapStartsOn(mode) {
  return mode !== "disabled";
}
