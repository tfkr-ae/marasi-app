// Where the Ledger's row menu and its submenus open, from the boxes of the
// things they open beside. Plain module: no Svelte or DOM, so tests load it
// directly. Boxes are viewport rects { left, top, right, bottom }.

/** How far a menu stays from the viewport's edges. */
const EDGE = 4;

/**
 * The menu at pointer (`x`, `y`): below the pointer when it fits there,
 * else above it, else as high as it fits; left of the pointer when it would
 * run off the right edge.
 */
export function placeMenu({ x, y, width, height, viewport }) {
  const below = y + height <= viewport.height - EDGE;
  const above = y - height >= EDGE;
  return {
    left: Math.max(EDGE, x + width > viewport.width - EDGE ? x - width : x),
    top: below ? y : above ? y - height : Math.max(EDGE, viewport.height - height - EDGE),
  };
}

/**
 * A submenu of `width` × `height` beside `row`, an item of the `parent`
 * panel. It sits flush against the parent's edge (their borders overlap).
 * A first-level submenu takes the side with room for all `levels` that can
 * open from it, so nested ones never land on the menu; a deeper one keeps
 * `parentLeftward`'s side unless it doesn't fit there. It runs down from
 * the row, its first item level with it, when it fits; else up, its last
 * item level with the row; else it takes the roomier side and scrolls
 * (`maxHeight`). `inset` is how far the panel's items sit inside its
 * edges ({ top, bottom }: border plus padding), measured, since the padding
 * scales with the Text size. Returns { left, top, maxHeight, leftward }.
 */
export function placeSubmenu({ row, parent, width, height, viewport, inset, levels = 1, parentLeftward = null }) {
  const fitsRight = parent.right - 1 + width * levels <= viewport.width - EDGE;
  const fitsLeft = parent.left + 1 - width * levels >= EDGE;
  const roomierLeft = parent.left > viewport.width - parent.right;
  const leftward =
    parentLeftward === true ? fitsLeft || !fitsRight : !fitsRight && (fitsLeft || roomierLeft);
  const left = leftward
    ? Math.max(EDGE, parent.left + 1 - width)
    : Math.max(EDGE, Math.min(parent.right - 1, viewport.width - EDGE - width));

  const down = row.top - inset.top;
  const up = row.bottom + inset.bottom - height;
  if (down + height <= viewport.height - EDGE) return { left, top: down, maxHeight: height, leftward };
  if (up >= EDGE) return { left, top: up, maxHeight: height, leftward };
  const roomBelow = viewport.height - EDGE - down;
  const roomAbove = row.bottom + inset.bottom - EDGE;
  return roomBelow >= roomAbove
    ? { left, top: down, maxHeight: roomBelow, leftward }
    : { left, top: EDGE, maxHeight: roomAbove, leftward };
}
