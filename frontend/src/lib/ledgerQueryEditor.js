// Suggestions for the Ledger's query box, by what the cursor follows:
// nothing (ready-made queries), a field name (its operators), a field and an
// operator (the field's example value), or part of a word (fields and AND,
// OR, NOT that start with it). Marasi's parser stays the authority on
// whether a query is valid; this only reads enough to suggest.
//
// Plain module: no CodeMirror or Svelte dependencies. LedgerQueryBox turns
// the result into CodeMirror completions.
import { QUERY_FIELDS } from "./ledgerQueryFields.js";

const KEYWORDS = ["AND", "OR", "NOT"];
const OPERATOR = /(!=|>=|<=|=|>|<|:)/;

/** The QUERY_FIELDS entry for a field name, including metadata.<key>. */
export function fieldNamed(name) {
  return (
    QUERY_FIELDS.find((f) => f.name === name) ||
    (/^metadata\.\w[\w.]*$/.test(name) ? QUERY_FIELDS.find((f) => f.name === "metadata.<key>") : undefined)
  );
}

// What choosing a field inserts: a field whose only operator is ":" gets it
// straight away; metadata.<key> stops at the dot for the key.
function fieldInsert(field) {
  if (field.name === "metadata.<key>") return "metadata.";
  return field.ops.length === 1 && field.ops[0] === ":" ? `${field.name}:` : `${field.name} `;
}

// The values suggested after `op`: the field's own list for it, else the
// example's value when the example uses `op` (`status_code >= 500` → `500`).
function valuesAfter(field, op) {
  if (field.values?.[op]) return field.values[op];
  const m = field.example.match(/^[\w.<>]+\s*(!=|>=|<=|=|>|<|:)\s*(.*)$/);
  return m && m[1] === op ? [m[2]] : [];
}

/**
 * Where to underline Marasi's query error in `doc`: { from, to } as editor
 * (UTF-16) offsets, or null for no underline. It covers the word starting at
 * the error's 1-based position, which Marasi counts in characters, or the
 * rest of the query when no word starts there. An error without a position,
 * such as one in the exclusion, or one past the end underlines nothing.
 */
export function queryErrorRange(doc, error) {
  if (!error?.position) return null;
  const from = Array.from(doc).slice(0, Math.max(error.position - 1, 0)).join("").length;
  const word = doc.slice(from).match(/^[^\s()]+/)?.[0];
  const to = word ? from + word.length : doc.length;
  return to > from ? { from, to } : null;
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
 * whole query's length. `readyMade` lists the { label, query } entries
 * offered in an empty box.
 */
/**
 * Whether the suggestion list opens with its first option chosen, so Enter
 * takes it. In a blank box it opens with none chosen: the box was just
 * cleared or focused, and Enter runs it as it stands (back to live) rather
 * than a ready-made query. Down chooses one.
 */
export function choosesFirstSuggestion(query) {
  return query.trim() !== "";
}

// CodeMirror keeps a completion explicit for as long as its list stays open,
// so typing or pasting after the ready-made list (opened on focus) or
// Ctrl-Space would keep offering every field. Count a request as explicit
// only at the position where it was made.
export function explicitCompletion() {
  let requestedAt = -1;
  return {
    request(pos) {
      requestedAt = pos;
    },
    at(explicit, pos) {
      return explicit && pos === requestedAt;
    },
  };
}

export function querySuggestions(before, length, explicit = false, readyMade = []) {
  const pos = before.length;
  if (!before.trim() && readyMade.length) {
    if (length && !explicit) return null;
    return {
      from: 0,
      to: length,
      options: readyMade.map((q) => ({
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
    // Only values that extend what is typed, so Enter on a value the
    // researcher finished runs the query instead of replacing it.
    const typedValue = m[3];
    const values = valuesAfter(valueField, m[2]).filter((v) => v !== typedValue && v.startsWith(typedValue));
    if (!values.length) return null;
    return {
      from: pos - typedValue.length,
      options: values.map((value) => ({
        label: value, insert: `${value} `, detail: "example", info: valueField.help, kind: "value", next: false,
      })),
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
