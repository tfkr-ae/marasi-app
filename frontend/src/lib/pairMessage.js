// A request/response pair's messages as the tools take them: a card's part
// (GLOSSARY: Part), its raw text with LF line endings, its head and body,
// and whether it has a response yet. Plain functions, shared by the cards
// (lib/tools), CyberChef's From bar (lib/tools/cyberchef) and the stores
// that read raw messages for them.

/** The parts of a pair a card or input can hold, with their names. */
export const PART_NAMES = { request: "Request", response: "Response", both: "Request + Response" };

/** True once the pair's row (the Ledger's shape) shows a response. */
export const hasResponse = (row) => Number(row?.StatusCode) > 0;

/**
 * A pair's raw request or response with LF line endings, as the Ledger
 * shows it and Send to CyberChef takes it from there (CodeMirror rewrites
 * \r\n to \n), so the same pair is the same text either way.
 */
export function pairText(raw) {
  return String(raw ?? "").replace(/\r\n/g, "\n");
}

/**
 * A message's text (LF line endings) split at the blank line after its
 * headers: { head, body }, body "" when there is none. `hasBody` says
 * whether the blank line is there at all.
 */
export function splitMessage(text) {
  const cut = text.indexOf("\n\n");
  return cut < 0 ? { head: text, body: "", hasBody: false } : { head: text.slice(0, cut), body: text.slice(cut + 2), hasBody: true };
}

/** A header field line's name, before its first colon (HTTP/2 pseudo-headers keep their leading one), or "". */
export const headerName = (line) => line.slice(0, Math.max(0, line.indexOf(":", 1)));
