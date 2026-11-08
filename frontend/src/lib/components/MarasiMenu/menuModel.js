// The Marasi menu as data: its sections, menu groups, loose menu actions and
// every entry's menu key, plus the two questions the menu asks of it: which
// entry a key picks at a level, and what a search matches there. Loads under
// node; MarasiMenu.svelte draws it.
//
// A level is the top (both sections together) or one open menu group. Menu
// keys are binding strings in the dispatcher's form ("meta+shift+l"):
// 1. A group's is primary + its menu letter (the factory letter or the
//    profile's override). Overridden groups claim theirs first, so a
//    profile's letter wins over a factory letter a later release gives
//    another group; that group then gets a derived letter (rule 3).
// 2. An action's is its first binding that starts with primary, exactly
//    (shift and alt kept), if nothing earlier at its level uses it and it
//    isn't reserved.
// 3. Anything left gets primary + a letter derived from the label's
//    distinctive words.
// primary is ⌘ on macOS and Ctrl on Windows/Linux. The menu shortcut and
// primary + a reserved menu letter (menuGroups.js) are never menu keys.
import { OPEN_MENU } from "../../keybindings/keymap.js";
import { RESERVED_MENU_LETTERS } from "../../keybindings/menuGroups.js";
import { MACOS } from "../../keybindings/platform.js";
import { matchesMenuSearch } from "./menuSearch.js";

export function primaryModifier(platform) {
  return platform === MACOS ? "meta" : "ctrl";
}

// Words that never give a derived letter.
const FILLER = new Set(["to", "in", "the", "a", "an", "of", "for", "by", "as", "on", "and", "or"]);
const wordsOf = (label) => String(label ?? "").split(/[^A-Za-z]+/).filter(Boolean);

// The menu keys of one level's rows, set on each row as `menuKey`.
function assignKeys(rows, { primary, reserved, bindingsFor, groupLabel = "" }) {
  const used = new Set();
  const free = (binding) => binding && !used.has(binding) && !reserved.has(binding);
  const take = (row, binding) => {
    used.add(binding);
    row.menuKey = binding;
  };
  const shared = new Set(wordsOf(groupLabel).map((w) => w.toLowerCase()));
  const derive = (row) => {
    const all = wordsOf(row.kind === "group" ? row.label : row.name);
    const distinct = all.filter((w) => !FILLER.has(w.toLowerCase()) && !shared.has(w.toLowerCase()));
    const candidates = [
      ...distinct.map((w) => w[0]),
      ...distinct.join(""),
      ...all.map((w) => w[0]),
      ...all.join(""),
    ];
    for (const letter of candidates) {
      const binding = `${primary}+${letter.toLowerCase()}`;
      if (free(binding)) return take(row, binding);
    }
    row.menuKey = null;
  };

  const groups = rows.filter((row) => row.kind === "group").sort((a, b) => Number(b.overridden) - Number(a.overridden));
  const actions = rows.filter((row) => row.kind !== "group");
  for (const row of groups) {
    const binding = `${primary}+${row.letter.toLowerCase()}`;
    if (free(binding)) take(row, binding);
    else derive(row);
  }
  for (const row of actions) {
    const own = row.actionId ? bindingsFor(row.actionId).find((b) => b.startsWith(`${primary}+`)) : null;
    if (free(own)) take(row, own);
  }
  // A word every action at this level shares names none of them.
  if (actions.length > 1) {
    const sets = actions.map((row) => new Set(wordsOf(row.name).map((w) => w.toLowerCase())));
    for (const word of sets[0]) if (sets.every((set) => set.has(word))) shared.add(word);
  }
  for (const row of actions) if (row.menuKey === undefined) derive(row);
}

// One section's groups (in catalog order) and loose actions (in entry
// order). A group with one action in `entries` is shown as that action.
function buildSection(scope, entries, catalog, letters) {
  const groups = new Map();
  const actions = entries.map((entry) => {
    const action = entry.actionId ? catalog.get(entry.actionId) : null;
    const row = {
      kind: "action",
      scope,
      name: action?.label,
      subtitle: action?.description,
      keywords: action?.keywords,
      ...entry,
      group: null,
    };
    const definition = action?.group ? catalog.group(action.context, action.group) : null;
    if (definition) {
      const id = `${definition.context}.${definition.id}`;
      if (!groups.has(id)) {
        groups.set(id, {
          kind: "group",
          scope,
          id,
          label: definition.label,
          letter: (letters?.[id] ?? definition.letter).toUpperCase(),
          overridden: letters?.[id] !== undefined,
          icon: definition.icon,
          tone: definition.tone,
          description: definition.description,
          order: catalog.groups.indexOf(definition),
          items: [],
        });
      }
      groups.get(id).items.push(row);
    }
    return row;
  });
  const shown = [...groups.values()].filter((g) => g.items.length > 1).sort((a, b) => a.order - b.order);
  for (const g of shown) for (const item of g.items) item.group = g;
  const loose = actions.filter((row) => !row.group);
  return { scope, groups: shown, loose, rows: [...shown, ...loose] };
}

/**
 * The Marasi menu for a menu context.
 * - `pageEntries`, `globalEntries`: the menu's entries ({ actionId, icon,
 *   and optionally name, subtitle, keywords }), page first. Text not given
 *   comes from the catalog.
 * - `bindingsFor(actionId)`: the live keymap's bindings (the dispatcher's).
 * - `letters`: the profile's menu-letter overrides, by group id
 *   ("<context>.<group>").
 * Returns { platform, primary, sections: [{ scope, groups, loose, rows }] },
 * with only non-empty page sections. Every row has `menuKey` (or null).
 */
export function buildMenu({ catalog, pageEntries = [], globalEntries = [], bindingsFor, platform, letters = {} }) {
  const primary = primaryModifier(platform);
  const reserved = new Set([
    ...RESERVED_MENU_LETTERS.map((letter) => `${primary}+${letter.toLowerCase()}`),
    ...bindingsFor(OPEN_MENU),
  ]);
  const page = buildSection("page", pageEntries, catalog, letters);
  const global = buildSection("global", globalEntries, catalog, letters);
  const sections = page.rows.length ? [page, global] : [global];
  const keys = { primary, reserved, bindingsFor };
  assignKeys(
    sections.flatMap((s) => s.rows),
    keys,
  );
  for (const g of sections.flatMap((s) => s.groups)) assignKeys(g.items, { ...keys, groupLabel: g.label });
  return { platform, primary, sections };
}

// The rows at a level, in draw order: the top (`group` empty) or the open
// group's actions.
export function rowsAt(menu, group = null) {
  if (group) return menu.sections.flatMap((s) => s.groups).find((g) => g.id === group)?.items ?? [];
  return menu.sections.flatMap((s) => s.rows);
}

// The entry a key picks at a level, or null. Menu keys are off while the
// search has text, so the primary modifier with A, C, V, X or Z edits it.
export function entryForKey(menu, { group = null, query = "", binding }) {
  if (String(query).trim() !== "" || !binding) return null;
  return rowsAt(menu, group).find((row) => row.menuKey === binding) ?? null;
}

// What a search matches at a level, in draw order: at the top, the groups
// whose label matches, then every matching action in every group and loose;
// inside a group, its matching actions. An action also matches by its
// group's label. One letter matches word starts only, since as a substring
// it matches nearly everything.
export function searchMenu(menu, { group = null, query = "" }) {
  const q = String(query).trim();
  if (!q) return rowsAt(menu, group);
  const actions = group
    ? rowsAt(menu, group)
    : rowsAt(menu).flatMap((row) => (row.kind === "group" ? row.items : [row]));
  const groups = group ? [] : rowsAt(menu).filter((row) => row.kind === "group");
  if (q.length === 1) {
    const letter = q.toLowerCase();
    const starts = (text) =>
      String(text ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((w) => w.startsWith(letter));
    return [...groups.filter((g) => starts(g.label)), ...actions.filter((a) => starts(a.name))];
  }
  return [
    ...groups.filter((g) => matchesMenuSearch({ name: g.label }, q)),
    ...actions.filter((a) => matchesMenuSearch({ ...a, label: a.group?.label }, q)),
  ];
}
