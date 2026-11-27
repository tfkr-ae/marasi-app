// The fields a ledger query can name, shown by the "?" toggle beside the query
// box and offered as its suggestions. Hard-coded to match marasi's traffic query grammar
// (marasi db/traffic_query.go): update it when that grammar changes.
//
// Plain module: no Svelte component dependencies.

/** How bare text and the boolean operators work, shown above the fields. */
export const QUERY_PREAMBLE =
  "Bare text, for example eyJhbGci, matches pairs that contain it in any text part: request, response, note or metadata. " +
  "Text terms need 3 or more characters. " +
  "Combine conditions with AND, OR, NOT, - and parentheses; a space between them means AND. " +
  "Quote a UUID wherever a field takes one.";

// A streamed direction's message framings (GLOSSARY Message framing), then
// "*" for any.
const FRAMING_VALUES = ['"grpc"', '"grpc-web"', '"connect"', '"sse"', '"ndjson"', '"*"'];

/**
 * One entry per field: its name, the operators it accepts, an example that
 * can be inserted into the query box, and one line of help. `values`, when
 * present, lists the values the query box suggests after an operator; without
 * it, the example's value is suggested after the example's operator.
 */
export const QUERY_FIELDS = [
  { name: "id", ops: ["=", "!="], example: 'id = "01937f5d-351a-7e68-936d-61a7a25661a3"', values: { "=": [], "!=": [] }, help: 'The pair\'s id, a quoted UUID: id = "<uuid>" for one pair, id != "<uuid>" for every other. Any case.' },
  { name: "number", ops: ["=", "!=", "<", "<=", ">", ">="], example: "number = 10", help: "The pair number, a whole number. It follows capture order and never changes." },
  { name: "host", ops: ["=", "!="], example: 'host = "*.acme.test"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "method", ops: ["=", "!="], example: 'method = "POST"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "scheme", ops: ["=", "!="], example: 'scheme = "https"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "path", ops: ["=", "!="], example: 'path = "/api/*"', help: "Exact case. * at the start or end is a wildcard." },
  { name: "content_type", ops: ["=", "!="], example: 'content_type = "application/json*"', help: "Exact case. * at the start or end is a wildcard. In-flight pairs have none." },
  { name: "status_code", ops: ["=", "!=", "<", "<=", ">", ">=", ":"], example: "status_code >= 500", values: { ":": ["*"] }, help: "Whole number. status_code:* for pairs with a response, NOT status_code:* for in-flight pairs." },
  { name: "requested_at", ops: ["=", "!=", "<", "<=", ">", ">="], example: 'requested_at > "2026-10-09T10:00:00Z"', help: "RFC 3339 timestamp." },
  { name: "responded_at", ops: ["=", "!=", "<", "<=", ">", ">="], example: 'responded_at < "2026-10-09T10:00:00Z"', help: "RFC 3339 timestamp." },
  { name: "client_protocol", ops: ["=", "!="], example: 'client_protocol = "h2"', values: { "=": ['"h2"', '"http/1.1"'], "!=": ['"h2"', '"http/1.1"'] }, help: 'The protocol between the client and Marasi: "http/1.1" or "h2".' },
  { name: "origin_protocol", ops: ["=", "!="], example: 'origin_protocol = "http/1.1"', values: { "=": ['"h2"', '"http/1.1"'], "!=": ['"h2"', '"http/1.1"'] }, help: 'The protocol between Marasi and the origin. It differs from client_protocol only when Marasi translated the pair.' },
  { name: "upstream_proxy", ops: ["=", "!="], example: 'upstream_proxy = "burp"', help: 'The upstream proxy that carried the pair, by name; upstream_proxy = "" for pairs sent directly. Pairs with no response yet match neither.' },
  { name: "length", ops: ["=", "!=", "<", "<=", ">", ">="], example: "length > 100000", help: "Response size in bytes, a whole number. Pairs with no response have no length." },
  { name: "metadata.<key>", ops: ["=", "!=", ":"], example: 'metadata.extension = "workshop"', values: { ":": ["*"] }, help: "The value at that key, a dotted path: a string, number, true, false or null. metadata.<key>:* for pairs that have the key." },
  { name: "highlight", ops: ["=", "!=", ":"], example: "highlight = 1", values: { ":": ["*"] }, help: "Highlight colour, 1 to 8. highlight:* for any highlighted pair." },
  { name: "sitemap", ops: ["=", "!="], example: 'sitemap = "https://api.acme.test/v2"', help: 'A sitemap node and everything under it, quoted; != for pairs outside it.' },
  { name: "launchpad", ops: ["=", "!=", ":"], example: "launchpad:*", values: { "=": [], "!=": [] }, help: 'Launchpad membership: launchpad = "<uuid>" for one launchpad, launchpad != "<uuid>" for pairs outside it, launchpad:* for pairs in any launchpad.' },
  { name: "finding", ops: ["=", "!=", ":"], example: "finding:*", values: { "=": [], "!=": [] }, help: 'Linked to a finding: finding = "<uuid>" for one finding, finding != "<uuid>" for pairs not linked to it, finding:* for pairs linked to any finding.' },
  { name: "test_case", ops: ["=", "!=", ":"], example: "test_case:*", values: { "=": [], "!=": [] }, help: 'Linked to a test case: test_case = "<uuid>" for one test case, test_case != "<uuid>" for pairs not linked to it, test_case:* for pairs linked to any test case.' },
  { name: "streamed", ops: [":"], example: "streamed:*", values: { ":": ["*"] }, help: "streamed:* for streamed pairs (gRPC, gRPC-Web, Connect, SSE, NDJSON), NOT streamed:* for every other pair." },
  { name: "request_framing", ops: ["=", "!="], example: 'request_framing = "grpc"', values: { "=": FRAMING_VALUES, "!=": FRAMING_VALUES }, help: 'The request\'s message framing: "grpc", "grpc-web", "connect", "sse" or "ndjson". = "*" for any streamed request; != also matches a request that isn\'t streamed.' },
  { name: "response_framing", ops: ["=", "!="], example: 'response_framing = "sse"', values: { "=": FRAMING_VALUES, "!=": FRAMING_VALUES }, help: 'The response\'s message framing, as for request_framing. = "*" for any streamed response; != also matches a response that isn\'t streamed.' },
  { name: "request_head", ops: [":"], example: 'request_head:"authorization"', help: "Contains, ignoring case. Request line plus headers." },
  { name: "request_body", ops: [":"], example: 'request_body:"password"', help: "Contains, ignoring case. Binary bodies never match." },
  { name: "response_head", ops: [":"], example: 'response_head:"set-cookie"', help: "Contains, ignoring case. Status line plus headers." },
  { name: "response_body", ops: [":"], example: 'response_body:"eyJhbGci"', help: "Contains, ignoring case. Binary bodies never match." },
  { name: "note", ops: [":"], example: 'note:"idor"', values: { ":": ['"idor"', "*"] }, help: "Contains, ignoring case. note:* for any pair with a note." },
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

// Splits query text into words with their offsets: whitespace separates
// words, a quoted string stays inside its word, and each parenthesis is a
// word of its own. `depth` is the number of open parentheses around a word.
function queryWords(text) {
  const words = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "(" || ch === ")") {
      if (ch === ")") depth = Math.max(depth - 1, 0);
      words.push({ text: ch, start: i, end: i + 1, depth });
      if (ch === "(") depth++;
      i++;
    } else {
      const start = i;
      while (i < text.length && !/[\s()]/.test(text[i])) {
        if (text[i] === '"') {
          i++;
          while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
        }
        i++;
      }
      i = Math.min(i, text.length);
      words.push({ text: text.slice(start, i), start, end: i, depth });
    }
  }
  return words;
}

// The index of the first word of `term` in `words` where it stands as a
// condition of its own: outside parentheses, not negated and not joined by
// OR. -1 when it doesn't.
function findTerm(words, term) {
  const want = queryWords(term).map((word) => word.text);
  for (let i = 0; i + want.length <= words.length; i++) {
    if (!want.every((text, k) => words[i + k].text === text && words[i + k].depth === 0)) continue;
    const before = words[i - 1]?.text;
    const after = words[i + want.length]?.text;
    if (before === "NOT" || before === "OR" || after === "OR") continue;
    return i;
  }
  return -1;
}

/**
 * True when the query has `term` as a condition of its own, so the
 * researcher can toggle it off: outside parentheses, not negated and not
 * joined by OR.
 */
export function hasQueryTerm(text, term) {
  return findTerm(queryWords(text), term) !== -1;
}

/**
 * Returns the query text with `term` removed when it has it as a condition
 * of its own (with the AND that joined it), else with `term` appended. The
 * rest of the text stays as typed.
 */
export function toggleQueryTerm(text, term) {
  const words = queryWords(text);
  const at = findTerm(words, term);
  if (at === -1) return appendToQuery(text.trimEnd(), term);
  let first = at;
  let last = at + queryWords(term).length - 1;
  if (words[first - 1]?.text === "AND") first--;
  else if (words[last + 1]?.text === "AND") last++;
  const next = words[last + 1];
  const from = next ? words[first].start : (words[first - 1]?.end ?? 0);
  const to = next ? next.start : text.length;
  return (text.slice(0, from) + text.slice(to)).trim();
}
