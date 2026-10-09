// The fields a ledger query can name, shown by the "?" toggle beside the query
// box. Hard-coded to match marasi's traffic query grammar
// (marasi db/traffic_query.go): update it when that grammar changes.
//
// Plain module: no Svelte component dependencies.

/** How bare text and the boolean operators work, shown above the fields. */
export const QUERY_PREAMBLE =
  "Bare text, for example eyJhbGci, matches pairs that contain it in any text part: request, response, note or metadata. " +
  "Text terms need 3 or more characters. " +
  "Combine conditions with AND, OR, NOT, - and parentheses; a space between them means AND.";

/**
 * One entry per field: its name, the operators it accepts, an example that
 * can be inserted into the query box, and one line of help.
 */
export const QUERY_FIELDS = [
  { name: "host", ops: ["=", "!="], example: 'host = "*.acme.test"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "method", ops: ["=", "!="], example: 'method = "POST"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "scheme", ops: ["=", "!="], example: 'scheme = "https"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "path", ops: ["=", "!="], example: 'path = "/api/*"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "content_type", ops: ["=", "!="], example: 'content_type = "application/json*"', help: "Exact case. * at the start or end is a wildcard. In-flight pairs have none." },
  { name: "status_code", ops: ["=", "!=", "<", "<=", ">", ">="], example: "status_code >= 500", help: "Whole number. In-flight pairs have no status code." },
  { name: "requested_at", ops: ["=", "!=", "<", "<=", ">", ">="], example: 'requested_at > "2026-10-09T10:00:00Z"', help: "RFC 3339 timestamp." },
  { name: "responded_at", ops: ["=", "!=", "<", "<=", ">", ">="], example: 'responded_at < "2026-10-09T10:00:00Z"', help: "RFC 3339 timestamp." },
  { name: "metadata.<key>", ops: ["=", "!="], example: 'metadata.extension = "workshop"', help: "The value at that key: a string, number, true, false or null." },
  { name: "request_head", ops: [":"], example: 'request_head:"authorization"', help: "Contains, ignoring case. Request line plus headers." },
  { name: "request_body", ops: [":"], example: 'request_body:"password"', help: "Contains, ignoring case. Binary bodies never match." },
  { name: "response_head", ops: [":"], example: 'response_head:"set-cookie"', help: "Contains, ignoring case. Status line plus headers." },
  { name: "response_body", ops: [":"], example: 'response_body:"eyJhbGci"', help: "Contains, ignoring case. Binary bodies never match." },
  { name: "note", ops: [":"], example: 'note:"idor"', help: "Contains, ignoring case." },
  { name: "metadata", ops: [":"], example: 'metadata:"workshop"', help: "Contains, ignoring case, anywhere in the metadata." },
];

/**
 * Returns the query text with `example` appended, separated from any existing
 * text by one space.
 */
export function appendToQuery(text, example) {
  if (!text) return example;
  return /\s$/.test(text) ? text + example : `${text} ${example}`;
}
