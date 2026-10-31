// Which build counts as newer (GLOSSARY "Update": never an older build).
// A port of v1's update_version.go and nightlyCommit.
//
// Version strings, as the build workflow sets them in package.json's
// marasiBuild.version:
//   - release: the tag, "DD.MM.YYYY" with an optional "-<suffix>" for a
//     same-day re-release ("17.10.2026-1")
//   - nightly: "DD.MM.YYYY (<line> <commit>)", where the line is the
//     channel ("nightly" for v1, "v2-nightly" for v2) and the commit is the
//     short commit the build was made from. Naming the line keeps the two
//     nightlies apart: a v2 nightly never reads a v1 nightly's version.

const releaseDate = /^(\d{2})\.(\d{2})\.(\d{4})$/;

// Exactly "DD.MM.YYYY" as a UTC day in ms, or null.
function parseReleaseDate(text) {
  const match = releaseDate.exec(text);
  if (!match) return null;
  const [day, month, year] = match.slice(1).map(Number);
  const date = Date.UTC(year, month - 1, day);
  const parsed = new Date(date);
  if (parsed.getUTCDate() !== day || parsed.getUTCMonth() !== month - 1) return null;
  return date;
}

/** A release tag "DD.MM.YYYY[-suffix]" as {date, suffix}, or null. */
export function parseReleaseVersion(tag) {
  const cut = tag.indexOf("-");
  const datePart = cut < 0 ? tag : tag.slice(0, cut);
  const suffix = cut < 0 ? "" : tag.slice(cut + 1);
  if (cut >= 0 && !suffix) return null;
  const date = parseReleaseDate(datePart);
  return date === null ? null : { date, suffix };
}

const isDigit = (c) => c >= "0" && c <= "9";

// The leading run of digits or of non-digits.
function nextChunk(s) {
  const digits = isDigit(s[0]);
  let i = 1;
  while (i < s.length && isDigit(s[i]) === digits) i++;
  return [s.slice(0, i), s.slice(i), digits];
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Two runs of digits compared as numbers of any length.
function compareDigits(a, b) {
  a = a.replace(/^0+/, "");
  b = b.replace(/^0+/, "");
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return compareText(a, b);
}

// a and b with runs of digits compared as numbers, so "9" < "10".
function compareNatural(a, b) {
  while (a && b) {
    const [aChunk, aRest, aDigits] = nextChunk(a);
    const [bChunk, bRest, bDigits] = nextChunk(b);
    const c = aDigits && bDigits ? compareDigits(aChunk, bChunk) : compareText(aChunk, bChunk);
    if (c) return c;
    a = aRest;
    b = bRest;
  }
  return a === b ? 0 : a === "" ? -1 : 1;
}

/**
 * Whether release v is later than other: a later date, or on the same date
 * a re-release after it. The plain tag comes first, then suffixes in natural
 * order (-2 before -10).
 */
export function releaseNewerThan(v, other) {
  if (v.date !== other.date) return v.date > other.date;
  return compareNatural(v.suffix, other.suffix) > 0;
}

/** Whether s looks like a git commit hash, full or shortened. */
export function isCommitHash(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{4,64}$/.test(s);
}

/** "DD.MM.YYYY (<line> <commit>)" as {date, commit}, or null. */
export function parseNightlyVersion(text, line) {
  const marker = ` (${line} `;
  const cut = text.indexOf(marker);
  if (cut < 0 || !text.endsWith(")")) return null;
  const commit = text.slice(cut + marker.length, -1);
  if (!isCommitHash(commit)) return null;
  const date = parseReleaseDate(text.slice(0, cut));
  return date === null ? null : { date, commit };
}

// Whether two hashes name the same commit, where either may be shortened.
function sameCommit(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Whether the published nightly is an update for the running one: built
 * from another commit, and dated the same day or later. A running build
 * with no commit (a release switched to nightly) is ordered by date alone.
 */
export function isUpdateForNightly(published, running) {
  if (running.commit && sameCommit(published.commit, running.commit)) return false;
  return published.date >= running.date;
}

/**
 * Whether a release updates the running nightly: only when dated after it,
 * so switching from nightly to release never downgrades
 * (docs/adr/2026-10-17-switching-channel-never-downgrades.md).
 */
export function releaseUpdatesNightly(release, running) {
  return release.date > running.date;
}

/** The commit on the "Commit: <sha>" line of a nightly's notes, or null. */
export function nightlyCommit(notes) {
  for (const line of String(notes ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("Commit:")) continue;
    const commit = trimmed.slice("Commit:".length).trim();
    return isCommitHash(commit) ? commit : null;
  }
  return null;
}
