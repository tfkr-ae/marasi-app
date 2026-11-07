// An error the frontend acts on carries a code in its text, since the text
// is all Wails passes on: "<what>: <code> (<id>, <id>): <cause>" when it
// names ids, "<what>: <code>: <cause>" when it does not. The Go side builds
// them with codedError (coded_error.go: cli_missing, instance_failed,
// chrome_launch_failed) and by hand (chrome.go: listener_inactive,
// listener_loopback); the service client's ServiceError uses the same text
// for the service's refusals (lib/service/errors.js).

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
