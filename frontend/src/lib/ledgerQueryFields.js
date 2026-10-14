// The fields a ledger query can name, offered as suggestions in the query
// box. Hard-coded to match marasi's traffic query grammar
// (marasi db/traffic_query.go): update it when that grammar changes.
//
// Plain module: no Svelte component dependencies.

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
  { name: "launchpad", ops: ["=", "!=", ":"], example: "launchpad:*", help: 'Launchpad membership: launchpad = "<uuid>" for one launchpad, launchpad != "<uuid>" for pairs outside it, launchpad:* for pairs in any launchpad.' },
  { name: "request_head", ops: [":"], example: 'request_head:"authorization"', help: "Contains, ignoring case. Request line plus headers." },
  { name: "request_body", ops: [":"], example: 'request_body:"password"', help: "Contains, ignoring case. Binary bodies never match." },
  { name: "response_head", ops: [":"], example: 'response_head:"set-cookie"', help: "Contains, ignoring case. Status line plus headers." },
  { name: "response_body", ops: [":"], example: 'response_body:"eyJhbGci"', help: "Contains, ignoring case. Binary bodies never match." },
  { name: "note", ops: [":"], example: 'note:"idor"', help: "Contains, ignoring case." },
  { name: "metadata", ops: [":"], example: 'metadata:"workshop"', help: "Contains, ignoring case, anywhere in the metadata." },
];

/**
 * Queries offered when the query box is empty. Each works on any project:
 * no host, path or note specific to one engagement.
 */
export const READY_MADE_QUERIES = [
  { label: "Server errors", query: "status_code >= 500" },
  { label: "Client errors", query: "status_code >= 400 AND status_code < 500" },
  { label: "Redirects", query: "status_code >= 300 AND status_code < 400" },
  { label: "JSON responses", query: 'content_type = "application/json*"' },
  { label: "Writes", query: 'method = "POST" OR method = "PUT" OR method = "PATCH" OR method = "DELETE"' },
  { label: "Auth headers sent", query: 'request_head:"authorization"' },
  { label: "Cookies set", query: 'response_head:"set-cookie"' },
  { label: "JWTs in responses", query: 'response_body:"eyJhbGci"' },
  { label: "In any launchpad", query: "launchpad:*" },
];

/** The query syntax in brief, for the one-line legend under the toolbar. */
export const QUERY_SYNTAX = [
  { token: "text", meaning: "bare text, 3+ characters, any text part" },
  { token: "AND", meaning: "both; a space means AND" },
  { token: "OR", meaning: "either" },
  { token: "NOT  -", meaning: "exclude" },
  { token: "( )", meaning: "group" },
  { token: "*", meaning: "wildcard at the start or end" },
  { token: '"…"', meaning: "quote values" },
];
