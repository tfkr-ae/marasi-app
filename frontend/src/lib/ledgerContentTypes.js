// The Ledger's Types menu: content-type groups and the Shown and Hidden
// lists. The exclusion is a list of exact content types, as stored by
// SetFilters; a group only toggles its own fixed list of exact types.
//
// Plain module: no Svelte component dependencies.

/**
 * The exclusion a new project starts with. Copied from marasi's
 * db/migrations/00001_db_setup.sql (the filters column default): update it
 * when that default changes.
 */
export const DEFAULT_EXCLUSION = [
  "application/epub+zip", "application/gzip", "application/javascript", "application/msword",
  "application/octet-stream", "application/pdf", "application/rtf", "application/vnd.amazon.ebook",
  "application/vnd.apple.installer+xml", "application/vnd.mozilla.xul+xml", "application/vnd.ms-excel",
  "application/vnd.ms-fontobject", "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation", "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.visio",
  "application/x-7z-compressed", "application/x-abiword", "application/x-bzip", "application/x-bzip2",
  "application/x-cdf", "application/x-csh", "application/x-font-ttf", "application/x-font-woff",
  "application/x-rar-compressed", "application/x-shockwave-flash", "application/x-tar", "application/zip",
  "audio/3gpp", "audio/3gpp2", "audio/aac", "audio/aiff", "audio/basic", "audio/midi", "audio/mpeg",
  "audio/ogg", "audio/wav", "audio/webm", "audio/x-aiff", "audio/x-midi", "audio/x-mpegurl",
  "audio/x-ms-wma", "audio/x-wav", "binary/octet-stream", "font/otf", "font/ttf", "font/woff",
  "font/woff2", "image/apng", "image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png",
  "image/svg+xml", "image/tiff", "image/vnd.djvu", "image/vnd.microsoft.icon", "image/webp",
  "image/x-icon", "image/x-portable-bitmap", "image/x-portable-pixmap", "text/calendar", "text/css",
  "text/vcard", "video/3gpp", "video/3gpp2", "video/mp2t", "video/mp4", "video/mpeg", "video/ogg",
  "video/quicktime", "video/webm", "video/x-flv", "video/x-ms-wmv", "video/x-msvideo",
];

const byPrefix = (prefix) => DEFAULT_EXCLUSION.filter((t) => t.startsWith(prefix));

/**
 * The group chips, in menu order. Each group is a fixed list of exact types;
 * a type belongs to at most one group. Marasi stores a response without a
 * Content-Type header as application/octet-stream, so "" only ever means a
 * pair still waiting for its response; queries always show those, so "" is
 * in no group.
 */
export const CONTENT_TYPE_GROUPS = [
  { label: "HTML", types: ["text/html"] },
  { label: "JSON / XML", types: ["application/json", "application/problem+json", "application/ld+json", "application/xml", "text/xml"] },
  { label: "Text", types: ["text/plain", "text/event-stream", "text/csv", "text/markdown"] },
  { label: "Scripts", types: ["application/javascript", "text/javascript", "application/x-javascript"] },
  { label: "Styles", types: ["text/css"] },
  { label: "Images", types: byPrefix("image/") },
  { label: "Fonts", types: [...byPrefix("font/"), "application/vnd.ms-fontobject", "application/x-font-ttf", "application/x-font-woff"] },
  { label: "Media", types: [...byPrefix("audio/"), ...byPrefix("video/")] },
  {
    label: "Documents",
    types: DEFAULT_EXCLUSION.filter((t) => /pdf|msword|ms-excel|ms-powerpoint|officedocument|opendocument|rtf|epub|ebook|abiword|visio/.test(t))
      .concat(["text/calendar", "text/vcard"]),
  },
  {
    label: "Archives & binary",
    types: ["application/octet-stream", "binary/octet-stream", "application/zip", "application/gzip", "application/x-tar",
      "application/x-7z-compressed", "application/x-rar-compressed", "application/x-bzip", "application/x-bzip2",
      "application/x-shockwave-flash", "application/x-cdf", "application/x-csh", "application/vnd.apple.installer+xml",
      "application/vnd.mozilla.xul+xml"],
  },
];

/** The group a content type belongs to, or undefined. */
export function groupOf(contentType) {
  return CONTENT_TYPE_GROUPS.find((g) => g.types.includes(contentType));
}

/** "shown", "hidden" or "partial": how much of the group the exclusion hides. */
export function groupState(group, excluded) {
  const hidden = group.types.filter((t) => excluded.includes(t)).length;
  if (hidden === 0) return "shown";
  return hidden === group.types.length ? "hidden" : "partial";
}

/**
 * Returns the exclusion with the group toggled: a fully shown group is
 * hidden, and a partly or fully hidden group is shown.
 */
export function toggleGroup(group, excluded) {
  if (groupState(group, excluded) === "shown") {
    return [...excluded, ...group.types.filter((t) => !excluded.includes(t))];
  }
  return excluded.filter((t) => !group.types.includes(t));
}

/** Returns the exclusion with the content type hidden or shown. */
export function toggleType(contentType, excluded) {
  return excluded.includes(contentType)
    ? excluded.filter((t) => t !== contentType)
    : [...excluded, contentType];
}

/**
 * True when the exclusion holds exactly the default types. Compared as sets:
 * marasi's stored default lists video/x-msvideo twice.
 */
export function isDefaultExclusion(excluded) {
  const set = new Set(excluded);
  return set.size === DEFAULT_EXCLUSION.length && DEFAULT_EXCLUSION.every((t) => set.has(t));
}

/**
 * Splits the project's content types into the Types menu's lists.
 *
 * `counts` is CountContentTypes' result. `find` filters by type or group
 * label, ignoring case. Returns:
 * - shown: counted types the exclusion lets through, most pairs first;
 * - hidden: excluded types with traffic, most pairs first;
 * - idle: excluded types with no traffic yet, alphabetical;
 * - addable: `find` itself when it looks like a full type that is in no list.
 * Each entry is { contentType, count, group }.
 */
export function typeLists(counts, excluded, find = "") {
  const needle = find.trim().toLowerCase();
  const countOf = new Map(counts.map((c) => [c.ContentType, c.Count]));
  const entry = (contentType) => ({ contentType, count: countOf.get(contentType) ?? 0, group: groupOf(contentType)?.label });
  const matches = (e) => !needle || e.contentType.toLowerCase().includes(needle) || (e.group ?? "").toLowerCase().includes(needle);
  const byCount = (a, b) => b.count - a.count || a.contentType.localeCompare(b.contentType);

  const all = [...new Set([...countOf.keys(), ...excluded])].map(entry).filter(matches);
  const shown = all.filter((e) => !excluded.includes(e.contentType)).sort(byCount);
  const hidden = all.filter((e) => excluded.includes(e.contentType) && e.count > 0).sort(byCount);
  const idle = all.filter((e) => excluded.includes(e.contentType) && e.count === 0).sort((a, b) => a.contentType.localeCompare(b.contentType));
  const known = countOf.has(needle) || excluded.includes(needle);
  const addable = /^[\w.+-]+\/[\w.+-]+$/.test(needle) && !known ? needle : null;
  return { shown, hidden, idle, addable };
}
