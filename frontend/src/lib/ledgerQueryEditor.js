// Suggestions for the Ledger's query box, by what the cursor follows:
// nothing (ready-made queries), a field name (its operators), a field and an
// operator (the field's example value), or part of a word (fields and AND,
// OR, NOT that start with it). Marasi's parser stays the authority on
// whether a query is valid; this only reads enough to suggest.
//
// Plain module: no CodeMirror or Svelte dependencies. LedgerQueryBox turns
// the result into CodeMirror completions.
import { QUERY_FIELDS, READY_MADE_QUERIES } from "./ledgerQueryFields.js";

const KEYWORDS = ["AND", "OR", "NOT"];
const OPERATOR = /(!=|>=|<=|=|>|<|:)/;

/** The QUERY_FIELDS entry for a field name, including metadata.<key>. */
export function fieldNamed(name) {
  return (
    QUERY_FIELDS.find((f) => f.name === name) ||
    (/^metadata\.\w+$/.test(name) ? QUERY_FIELDS.find((f) => f.name === "metadata.<key>") : undefined)
  );
}

// What choosing a field inserts: a field whose only operator is ":" gets it
// straight away; metadata.<key> stops at the dot for the key.
function fieldInsert(field) {
  if (field.name === "metadata.<key>") return "metadata.";
  return field.ops.length === 1 && field.ops[0] === ":" ? `${field.name}:` : `${field.name} `;
}

// The example's value part: `status_code >= 500` → `500`.
function exampleValue(field) {
  return field.example.replace(/^[\w.<>]+\s*(!=|>=|<=|=|>|<|:)\s*/, "");
}

/**
 * Suggestions for the query text before the cursor, or null for none. A
 * suggestion is offered only when it adds to what is typed, so Enter runs a
 * finished query rather than re-inserting what is already there.
 *
 * Returns { from, to?, options }, where `from`/`to` are offsets into the
 * query that the chosen option replaces, and each option is
 * { label, insert, detail?, info?, kind, section?, next } with `next` true
 * when the next suggestions should open after inserting. `explicit` is true
 * when the researcher asked for suggestions (Ctrl-Space); `length` is the
 * whole query's length.
 */
export function querySuggestions(before, length, explicit = false) {
  const pos = before.length;
  if (!before.trim()) {
    if (length && !explicit) return null;
    return {
      from: 0,
      to: length,
      options: READY_MADE_QUERIES.map((q) => ({
        label: q.label, insert: q.query, detail: q.query, kind: "query", section: "Ready-made queries", next: false,
      })),
    };
  }

  let m = before.match(/(\w[\w.]*)\s+$/);
  const afterField = m && !KEYWORDS.includes(m[1]) ? fieldNamed(m[1]) : undefined;
  if (afterField) {
    return {
      from: pos,
      options: afterField.ops.map((op) => ({
        label: op, insert: op === ":" ? ":" : `${op} `, detail: `${m[1]} ${op} …`, info: afterField.help, kind: "operator", next: true,
      })),
    };
  }

  m = before.match(new RegExp(`(\\w[\\w.]*)\\s*${OPERATOR.source}\\s*("?[^"\\s]*)$`));
  const valueField = m ? fieldNamed(m[1]) : undefined;
  if (valueField) {
    // Only while the example extends what is typed, so Enter on a value
    // the researcher finished runs the query instead of replacing it.
    const value = exampleValue(valueField);
    const typedValue = m[3];
    if (typedValue === value || !value.startsWith(typedValue)) return null;
    return {
      from: pos - m[3].length,
      options: [{ label: value, insert: `${value} `, detail: "example", info: valueField.help, kind: "value", next: false }],
    };
  }

  const word = before.match(/[\w.]+$/)?.[0] ?? "";
  if (!word && !explicit) return null;
  // Prefix-only: "sta" offers status_code, not every field containing s…t…a.
  const typed = word.toLowerCase();
  const options = [
    ...QUERY_FIELDS.map((f) => ({
      label: f.name === "metadata.<key>" ? "metadata." : f.name,
      insert: fieldInsert(f), detail: f.ops.join(" "), info: `${f.help}\nExample: ${f.example}`, kind: "field", next: true,
    })),
    ...KEYWORDS.map((k) => ({ label: k, insert: `${k} `, detail: "operator", kind: "keyword", next: false })),
  ].filter((o) => o.label.toLowerCase().startsWith(typed) && o.label.toLowerCase() !== typed);
  return options.length ? { from: pos - word.length, options } : null;
}
