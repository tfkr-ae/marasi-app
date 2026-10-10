import { tierRank } from "./contexts.js";

// Marasi menus (palettes) currently mounted, by menu-context tier. The menu
// shortcut toggles the most specific one: the WebSocket modal's (overlay)
// over a page's (page) over the global menu (global). Within a tier the
// latest registration wins. Selection does not depend on mount order across
// tiers, because parents (the layout's global menu) mount after children.
export function createPaletteRegistry() {
  const entries = [];
  let sequence = 0;

  function register(tier, palette) {
    const entry = { rank: tierRank(tier), order: sequence++, palette };
    entries.push(entry);
    return () => {
      const index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
    };
  }

  function active() {
    let best = null;
    for (const entry of entries) {
      if (!best || entry.rank < best.rank || (entry.rank === best.rank && entry.order > best.order)) {
        best = entry;
      }
    }
    return best?.palette ?? null;
  }

  return { register, active };
}
