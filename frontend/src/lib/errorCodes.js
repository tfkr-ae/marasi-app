// A refusal's code is in its error's text (MarasiError, bindings/marasi.js),
// as v1's errors carried it: "<what>: <code> (<id>, <id>): <cause>" when the
// refusal names ids (launch_pending, selection_incomplete), and
// "<what>: <code>: <cause>" when it does not.

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The ids `code` names in `error`'s text, [] for a code without ids, or
 * null when the error does not carry `code`.
 */
export function codeIDs(error, code) {
  const match = new RegExp(`\\b${escape(code)}(?: \\(([^)]*)\\)|:)`).exec(String(error ?? ""));
  if (!match) return null;
  return (match[1] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}
