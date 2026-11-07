// Builds the traffic query the Launchpad tree's search sends to Marasi for
// entry matches. The researcher's text is never query syntax: it only ever
// appears as one AIP-160 string literal, so quotes, operators, parentheses
// and FTS characters in it are matched literally.

/** Marasi's trigram index cannot find shorter terms; it rejects them. */
export const MIN_ENTRY_SEARCH = 3;

// Marasi rejects queries longer than this many bytes. GET /launchpad/search
// wraps the query in `launchpad:* AND (…)`.
const MAX_QUERY_BYTES = 8192;
const WRAPPER_BYTES = "launchpad:* AND ()".length;

// request_head starts with the request line, so method, path and host match.
const PARTS = ["request_head", "request_body", "response_head", "response_body"];

/** `text` as an AIP-160 string literal: only \ and " need escaping. */
export const aipString = (text) => `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

/**
 * The query matching entries whose request or response head or body contains
 * `text`, trimmed. `{ query: null }` when the text is too short to search,
 * `{ query: null, error }` when it is too long for Marasi.
 */
export function entrySearchQuery(text) {
  const term = text.trim();
  if ([...term].length < MIN_ENTRY_SEARCH) return { query: null };
  const literal = aipString(term);
  const query = PARTS.map((part) => `${part}:${literal}`).join(" OR ");
  if (new TextEncoder().encode(query).length + WRAPPER_BYTES > MAX_QUERY_BYTES) {
    return { query: null, error: "Search text is too long to search entries." };
  }
  return { query };
}
