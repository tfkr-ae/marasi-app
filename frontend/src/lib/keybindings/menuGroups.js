// Menu groups and menu letters, in one place.
//
// A menu group is a Marasi-defined, named set of related menu actions that
// the Marasi menu shows as one entry. A menu action joins a group through
// its `group` field in the catalog (catalog.js). With the menu open, ⌘
// (Ctrl on Windows/Linux) + the group's menu letter opens it.
//
// Group order is catalog order. Never rename a group id: saved profiles key
// their menu-letter overrides by it. `icon` is a lucide icon name and `tone`
// a colour name; the Svelte layer turns both into components and classes
// (lib/components/MarasiMenu/groupStyle.js).

// Letters that are never menu letters, on every platform, so a profile
// moves between platforms: K is the menu shortcut (it closes the menu), and
// Q and H are macOS Quit and Hide.
export const RESERVED_MENU_LETTERS = Object.freeze(["K", "Q", "H"]);

function group(context, id, label, letter, icon, tone, description) {
  return Object.freeze({ context, id, label, letter, icon, tone, description });
}

// The factory menu groups. The global letters (G, P, B, A) are in use at
// the top level of every menu, so no page group may use them.
export const FACTORY_MENU_GROUPS = Object.freeze([
  group("global", "go", "Go to", "G", "Navigation", "sky", "Open any page"),
  group("global", "project", "Project", "P", "FolderOpen", "amber", "Projects, connections and updates"),
  group("global", "browser", "Browser & proxy", "B", "Globe", "teal", "Chrome, the certificate and intercept"),
  group("global", "appearance", "Appearance", "A", "Palette", "fuchsia", "Theme, text size and Vim"),
  // The Ledger. With the drawer open, the WebSocket stream action stays
  // loose; with it closed, only Focus is a group.
  group("ledger.drawer-open", "navigate", "Navigate", "N", "ArrowDownUp", "indigo", "Move between requests"),
  group("ledger.drawer-open", "focus", "Focus", "F", "Crosshair", "orange", "Jump to search, filter or the sitemap"),
  group("ledger.drawer-open", "send", "Send to", "S", "Send", "violet", "Hand requests to another tool"),
  group("ledger.drawer-open", "logbook", "Logbook", "L", "BookOpenCheck", "emerald", "Findings and test cases"),
  group("ledger.drawer-open", "copy", "Copy", "C", "Copy", "sky", "URLs and raw HTTP"),
  group("ledger.drawer-open", "view", "View", "V", "Eye", "rose", "Notes, metadata and layout"),
  group("ledger.drawer-closed", "focus", "Focus", "F", "Crosshair", "orange", "Jump to search, filter or the sitemap"),
]);
