// A Home card's colours, as an inline style: its 4px left border and its
// icon square (ChipIcon.svelte) in the 700 shade of the theme colour
// `colour`, the icon in shade `glyph`.
export const swatch = (colour, glyph = 200) =>
  `border-color: rgb(var(--color-${colour}-700)); --chip-bg: rgb(var(--color-${colour}-700)); --chip-fg: rgb(var(--color-${colour}-${glyph}))`;
