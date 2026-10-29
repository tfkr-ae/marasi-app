// How the Ledger writes counts: "1 request", "1,200 requests", "100,000+",
// "match" or "matches". Numbers use the reader's locale, as the rest of the
// app does.

/** `n` with "+" when Marasi capped the count, so more matched. */
export function formatCount(n, capped = false) {
  return `${n.toLocaleString()}${capped ? "+" : ""}`;
}

/** "1 request", "3 requests"; `many` for irregular plurals. */
export function plural(n, one, many = one + "s") {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "1 request", "3 requests". */
export function requestCount(n) {
  return plural(n, "request");
}

/** "match" or "matches" for `count`; `more` means there could be more. */
export function matchNoun(count, more = false) {
  return count === 1 && !more ? "match" : "matches";
}

/**
 * A menu row's match count, { count, capped }: "…" while loading
 * (undefined), "–" when it couldn't be counted (null), "!" for a query
 * Marasi rejects ({ error }), "100,000+" past Marasi's cap.
 */
export function matchCountText(count) {
  if (count === undefined) return "…";
  if (count === null) return "–";
  if (count.error) return "!";
  return formatCount(count.count, count.capped);
}

/**
 * Why a change to a ⌘A selection of `n` matching requests (null while
 * counted) touched none of them, for its toast. `change` is { type, name?,
 * noun? }: highlight, clear-highlight, clear-notes, add-to-launchpad,
 * remove-from-launchpad, link, unlink, or anything else. `request` words
 * one pair; the Launchpad, whose selection is never ⌘A, passes "request".
 */
export function unchangedText(change, n, request = "matching request") {
  if (n === 0) return `No ${request}s to change`;
  const one = n === 1;
  const counted = n == null ? `${request}s` : `${n.toLocaleString()} ${request}s`;
  // "All 3 matching requests were already …" / "The matching request was already …"
  const all = (rest) => (one ? `The ${request} was already ${rest}` : `All ${counted} were already ${rest}`);
  // "None of the 3 matching requests had …" / "The matching request had no …"
  const none = (verb, what, single) =>
    one ? `The ${request} ${single}` : `None of the ${counted} ${verb} ${what}`;
  const name = `"${change.name}"`;
  switch (change.type) {
    case "highlight":
      return all(`highlighted ${name}`);
    case "clear-highlight":
      return none("had", "a highlight", "had no highlight");
    case "clear-notes":
      return none("had", "a note", "had no note");
    case "add-to-launchpad":
      return all(`in ${name}`);
    case "remove-from-launchpad":
      return none("were", `in ${name}`, `wasn't in ${name}`);
    case "link":
      return all(`linked to ${change.noun} ${name}`);
    case "unlink":
      return none("were", `linked to ${change.noun} ${name}`, `wasn't linked to ${change.noun} ${name}`);
    default:
      return one ? `The ${request} didn't change` : `None of the ${counted} changed`;
  }
}
