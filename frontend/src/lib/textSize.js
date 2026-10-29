// The Text size setting: four named sizes that scale the root font size, so
// everything sized in rem follows (docs/adr/2026-10-29-text-size-scales-the-root-font-size.md).

/** The Text sizes, smallest first. */
export const TEXT_SIZES = Object.freeze([
  Object.freeze({ id: "small", label: "Small", scale: 0.9 }),
  Object.freeze({ id: "default", label: "Default", scale: 1 }),
  Object.freeze({ id: "large", label: "Large", scale: 1.125 }),
  Object.freeze({ id: "xlarge", label: "X-Large", scale: 1.25 }),
]);

/** The size the app opens at, and the one ⌘0 resets to. */
export const DEFAULT_TEXT_SIZE = TEXT_SIZES[1];

/** The size a saved value names. Anything else, such as a value from a newer version, is Default. */
export function textSizeFrom(saved) {
  return TEXT_SIZES.find((size) => size.id === saved) ?? DEFAULT_TEXT_SIZE;
}

function step(size, by) {
  const at = TEXT_SIZES.indexOf(size);
  return TEXT_SIZES[Math.min(Math.max(at + by, 0), TEXT_SIZES.length - 1)];
}

/** The next size up from `size`, or `size` itself at X-Large. */
export function largerTextSize(size) {
  return step(size, 1);
}

/** The next size down from `size`, or `size` itself at Small. */
export function smallerTextSize(size) {
  return step(size, -1);
}

/** The root font size at Default, which rem sizes are written against. */
const ROOT_FONT_PX = 16;

/** The root element's font size at `size`, as a CSS length. */
export function rootFontSize(size) {
  return `${ROOT_FONT_PX * size.scale}px`;
}

/** A Ledger row's height at Default. */
const LEDGER_ROW_PX = 22;

/**
 * A Ledger row's height in px at `size`. It is rounded to a whole pixel,
 * because the Ledger's scroll helpers compare exact integer offsets.
 */
export function ledgerRowHeight(size) {
  return Math.round(LEDGER_ROW_PX * size.scale);
}
