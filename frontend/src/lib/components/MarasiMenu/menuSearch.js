// The Marasi menu's search as data, so it loads under node.

/**
 * Whether `option` matches what was typed: every word of `input` appears,
 * in any order, in the option's name, subtitle or keywords, ignoring case.
 * "select all traffic" finds Select All Traffic, and so does "traffic all".
 */
export function matchesMenuSearch(option, input) {
  const words = String(input ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [option.name, option.subtitle, option.label, option.keywords]
    .flat()
    .filter((part) => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}
