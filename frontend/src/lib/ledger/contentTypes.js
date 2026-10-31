// The content-type exclusion as the Ledger's Types menu edits it. An
// exclusion value is an exact type ("text/css") or a whole major type
// ("image/*"), normalised as Marasi does. A pair with no content type (still
// waiting for its response) is never hidden.
//
// Plain module: no Svelte or Wails dependencies, so tests load it directly.

/** `value` lowercased, without parameters or surrounding space. */
export function normalizeContentType(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

// A MIME token (RFC 2045): no spaces, controls or separators.
const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/**
 * An exclusion list normalised as Marasi's NormalizeExclusion does; throws
 * on a value that isn't `type/subtype` or `type/*`.
 */
export function normalizeExclusion(values) {
  return values.map((value) => {
    const type = normalizeContentType(String(value));
    const [major, minor, ...rest] = type.split("/");
    if (rest.length || !TOKEN.test(major ?? "") || !TOKEN.test(minor ?? "")) {
      throw new Error(`invalid content-type exclusion "${value}": want type/subtype or type/*`);
    }
    if (major.includes("*") || (minor.includes("*") && minor !== "*")) {
      throw new Error(`invalid content-type exclusion "${value}": * may only stand for a whole subtype, as in image/*`);
    }
    return type;
  });
}

/** "image" for "image/png" and "image/*". */
function majorOf(contentType) {
  return contentType.split("/")[0];
}

/**
 * The exclusion value that hides `contentType`: the type itself, or its
 * `major/*`. null when the exclusion lets it through.
 */
export function hiddenBy(contentType, exclusion) {
  const type = normalizeContentType(contentType);
  if (type === "") return null;
  if (exclusion.includes(type)) return type;
  const wildcard = majorOf(type) + "/*";
  return exclusion.includes(wildcard) ? wildcard : null;
}

/**
 * The Types menu's group chips, in menu order. A group that is a whole
 * major type stores `major/*`; the others store their own exact types. A
 * type belongs to at most one group. "" (no response yet) is in none.
 */
export const CONTENT_TYPE_GROUPS = [
  { label: "HTML", types: ["text/html"] },
  {
    label: "JSON / XML",
    types: ["application/json", "application/problem+json", "application/ld+json", "application/xml", "text/xml"],
  },
  { label: "Text", types: ["text/plain", "text/event-stream", "text/csv", "text/markdown"] },
  { label: "Scripts", types: ["application/javascript", "text/javascript", "application/x-javascript"] },
  { label: "Styles", types: ["text/css"] },
  { label: "Images", types: ["image/*"] },
  {
    label: "Fonts",
    types: ["font/*", "application/vnd.ms-fontobject", "application/x-font-ttf", "application/x-font-woff"],
  },
  { label: "Audio", types: ["audio/*"] },
  { label: "Video", types: ["video/*"] },
  {
    label: "Documents",
    types: [
      "application/pdf", "application/rtf", "application/msword", "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint", "application/vnd.oasis.opendocument.presentation",
      "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.text",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/epub+zip", "application/vnd.amazon.ebook", "application/x-abiword",
      "application/vnd.visio", "text/calendar", "text/vcard",
    ],
  },
  {
    label: "Archives & binary",
    types: [
      "application/octet-stream", "binary/octet-stream", "application/zip", "application/gzip",
      "application/x-tar", "application/x-7z-compressed", "application/x-rar-compressed",
      "application/x-bzip", "application/x-bzip2", "application/x-shockwave-flash", "application/x-cdf",
      "application/x-csh", "application/vnd.apple.installer+xml", "application/vnd.mozilla.xul+xml",
    ],
  },
];

const isWildcard = (value) => value.endsWith("/*");

/** True when the group value `value` (exact or major/*) covers `contentType`. */
function covers(value, contentType) {
  return isWildcard(value) ? majorOf(contentType) === majorOf(value) : value === contentType;
}

/** The group a content type belongs to, or undefined. */
export function groupOf(contentType) {
  const type = normalizeContentType(contentType);
  if (type === "") return undefined;
  return CONTENT_TYPE_GROUPS.find((g) => g.types.some((value) => covers(value, type)));
}

/** True when the exclusion hides the group value: itself, or its major/*. */
function valueHidden(value, exclusion) {
  return exclusion.includes(value) || exclusion.includes(majorOf(value) + "/*");
}

/**
 * "shown", "hidden" or "partial": how much of the group the exclusion
 * hides. A major-type group with only some of its subtypes hidden is
 * partial.
 */
export function groupState(group, exclusion) {
  const hidden = group.types.filter((value) => valueHidden(value, exclusion)).length;
  if (hidden === group.types.length) return "hidden";
  const someSubtypes = exclusion.some(
    (value) => !isWildcard(value) && group.types.some((g) => isWildcard(g) && covers(g, value)),
  );
  return hidden > 0 || someSubtypes ? "partial" : "shown";
}

/**
 * Returns the exclusion with the group toggled: a fully shown group is
 * hidden, and a partly or fully hidden group is shown, dropping its values
 * and the subtypes its major/* values cover.
 */
export function toggleGroup(group, exclusion) {
  if (groupState(group, exclusion) === "shown") {
    return [...exclusion, ...group.types.filter((value) => !exclusion.includes(value))];
  }
  return exclusion.filter((value) => !group.types.some((g) => covers(g, value)));
}

/**
 * Returns the exclusion with the exact type hidden or shown. A type hidden
 * through its major/* stays hidden: the exclusion has no "except".
 */
export function toggleType(contentType, exclusion) {
  if (exclusion.includes(contentType)) return exclusion.filter((t) => t !== contentType);
  if (hiddenBy(contentType, exclusion)) return exclusion;
  return [...exclusion, contentType];
}

/** How the Types menu names a content type. */
export function typeLabel(contentType) {
  return contentType === "" ? "(no response)" : contentType;
}

/** True when `value`, normalised, is an exclusion value: type/subtype or type/*. */
export function isExclusionValue(value) {
  return /^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(normalizeContentType(value));
}

/**
 * Splits the project's content types into the Types menu's lists.
 *
 * `counts` is CountContentTypes' `Counts`. `find` filters by type, group
 * label or row label, ignoring case. Returns:
 * - shown: counted types the exclusion lets through, most pairs first; the
 *   no-response row ("") is always among them;
 * - hidden: counted types the exclusion hides, most pairs first;
 * - idle: exclusion values that hide no counted type, alphabetical;
 * - addable: `find`, normalised, when it is a type or major/* in no list.
 * Each entry is { contentType, count, group, hiddenBy }.
 */
export function typeLists(counts, exclusion, find = "") {
  const needle = find.trim().toLowerCase();
  const countOf = new Map([["", 0]]);
  for (const c of counts ?? []) {
    const type = normalizeContentType(c.ContentType);
    countOf.set(type, (countOf.get(type) ?? 0) + c.Count);
  }
  const entry = (contentType) => ({
    contentType,
    count: countOf.get(contentType) ?? 0,
    group: groupOf(contentType)?.label,
    hiddenBy: hiddenBy(contentType, exclusion),
  });
  const matches = (e) =>
    !needle ||
    [e.contentType, typeLabel(e.contentType), e.group ?? ""].some((s) => s.toLowerCase().includes(needle));
  const byCount = (a, b) => b.count - a.count || a.contentType.localeCompare(b.contentType);

  const counted = [...countOf.keys()].map(entry);
  const shown = counted.filter((e) => !e.hiddenBy && matches(e)).sort(byCount);
  const hidden = counted.filter((e) => e.hiddenBy && matches(e)).sort(byCount);
  const used = new Set(counted.map((e) => e.hiddenBy));
  const idle = [...new Set(exclusion)]
    .filter((value) => !used.has(value))
    .map((value) => ({ contentType: value, count: 0, group: groupOf(value)?.label, hiddenBy: value }))
    .filter(matches)
    .sort((a, b) => a.contentType.localeCompare(b.contentType));

  const candidate = normalizeContentType(needle);
  const known = countOf.has(candidate) || exclusion.includes(candidate);
  const addable = isExclusionValue(candidate) && !known ? candidate : null;
  return { shown, hidden, idle, addable };
}

/**
 * The exclusion as Settings → Content Types lists it, filtered by `find`.
 *
 * `find` matches a value or its group label, ignoring case. Returns:
 * - groups: [{ label, types }] in menu order with "Other" last, each
 *   group's values sorted; empty groups are left out;
 * - shown: how many values the groups list;
 * - exists: `find`, normalised, is already in the exclusion;
 * - addable: `find`, normalised, when it is a type or major/* not yet in it.
 */
export function exclusionGroups(exclusion, find = "") {
  const needle = find.trim().toLowerCase();
  const byLabel = new Map([...CONTENT_TYPE_GROUPS.map((g) => [g.label, []]), ["Other", []]]);
  for (const value of [...new Set(exclusion)].sort()) {
    const label = groupOf(value)?.label ?? "Other";
    if (!needle || value.includes(needle) || label.toLowerCase().includes(needle)) byLabel.get(label).push(value);
  }
  const groups = [...byLabel].filter(([, types]) => types.length).map(([label, types]) => ({ label, types }));
  const candidate = normalizeContentType(needle);
  const exists = exclusion.includes(candidate);
  return {
    groups,
    shown: groups.reduce((n, g) => n + g.types.length, 0),
    exists,
    addable: isExclusionValue(candidate) && !exists ? candidate : null,
  };
}
