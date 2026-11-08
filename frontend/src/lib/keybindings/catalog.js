import { CONTEXTS, extensionPageContext } from "./contexts.js";
import { isReservedBinding } from "./gate.js";
import { normalizeBinding } from "./keys.js";
import { OPEN_MENU } from "./keymap.js";
import { FACTORY_MENU_GROUPS } from "./menuGroups.js";
import { MACOS, PLATFORMS, WINDOWS_LINUX } from "./platform.js";

// The menu action catalog: stable identity, menu context, label/description
// for display, and immutable factory default bindings per platform variant.
// Handlers are not part of the catalog; components register them with the
// dispatcher by action id. Icons stay in the Svelte layer.

const ACTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

// Same key on both platforms except the primary modifier: ⌘ on macOS,
// Ctrl on Windows/Linux.
function primary(...keys) {
  return {
    [MACOS]: keys.map((key) => `meta+${key}`),
    [WINDOWS_LINUX]: keys.map((key) => `ctrl+${key}`),
  };
}

// The same keys on every platform.
function both(...keys) {
  return { [MACOS]: keys, [WINDOWS_LINUX]: keys };
}

// `options` holds the action's context (global when absent) and flags such
// as `group`, the menu group of its context it joins (menuGroups.js).
function action(id, label, description, keywords, defaults, { context = "global", ...flags } = {}) {
  return { id, context, label, description, keywords, defaults, ...flags };
}

// One page or drawer menu: each action's id is `<context>.<slug>`, so ids
// stay unique when a key or label is reused in a mutually exclusive state.
// A row's optional sixth element adds flags: `group`, its menu group, or
// `yieldsToEditors`: the action never runs while focus is in an editor or
// text field, which keeps its keys there (⌘⇧↓ selects to the end in
// CodeMirror).
function pageActions(context, rows) {
  return rows.map(([slug, label, description, keywords, defaults, flags = {}]) =>
    action(`${context}.${slug}`, label, description, keywords, defaults, { ...flags, context }),
  );
}

// The built-in actions. An action listed here shows in the keybinding
// settings and is checked on save, since the catalog is sent to Go with each
// profile (catalogDescriptor). Its handler is registered separately
// (useMenuActions, or the handlers in GlobalMenu.svelte for global.*), and a
// page lists it in ⌘K only through its menuOptions. Never rename an id:
// saved profiles key their overrides by id.
export const FACTORY_ACTIONS = [
  action("global.open-menu", "Open Marasi Menu", "Open or close the Marasi menu", "menu, commands, palette", primary("k")),
  action("global.go-home", "Marasi", "Dashboard", "home, dashboard", primary("1"), { group: "go" }),
  action("global.go-ledger", "Ledger", "View requests", "ledger", primary("2"), { group: "go" }),
  action("global.go-compass", "Compass", "Configure scope", "compass", primary("3"), { group: "go" }),
  action("global.go-checkpoint", "Checkpoint", "Intercept Requests", "checkpoint", primary("4"), { group: "go" }),
  action("global.go-launchpad", "Launchpad", "Edit and Repeat Requests", "Launchpad", primary("5"), { group: "go" }),
  action("global.go-armory", "Armory", "Create request templates", "armory,template,attack", primary("6"), { group: "go" }),
  action("global.go-logbook", "Logbook", "Review test cases and findings", "logbook,findings,tests", primary("7"), { group: "go" }),
  action("global.go-workshop", "Workshop", "Extend Marasi", "Workshop", primary("8"), { group: "go" }),
  action("global.go-settings", "Settings", "Configure your settings", "settings", primary(","), { group: "go" }),
  action("global.start-chrome", "Start Chrome", "Start Browser", "Chrome", primary("`"), { group: "browser" }),
  action("global.download-certificate", "Download Certificate", "Download Certificate", "certificate,download", primary("d"), { group: "browser" }),
  action("global.copy-certificate", "Copy Certificate", "Copy Certificate", "certificate,copy", primary("shift+,"), { group: "browser" }),
  action("global.jump-to-toast", "Jump to Toast", "Jump to the active toast", "toast", primary(".")),
  action("global.open-project", "Open Project", "Open a project", "open project", primary("o"), { group: "project" }),
  action("global.setup-listener", "Setup Listener", "Start a new listener", "listener", primary("l"), { group: "project" }),
  action("global.toggle-vim", "Toggle Vim Mode", "Toggle Vim Mode in editor views", "vim", primary("t"), { group: "appearance" }),
  action("global.toggle-light-mode", "Toggle Light Mode", "Switch between light and dark mode", "theme, light, dark, mode, ui", primary("u"), { group: "appearance" }),
  action("global.increase-text-size", "Increase Text Size", "Make all text one size larger", "text, font, size, larger, bigger, zoom in", primary("="), { group: "appearance" }),
  action("global.decrease-text-size", "Decrease Text Size", "Make all text one size smaller", "text, font, size, smaller, zoom out", primary("-"), { group: "appearance" }),
  action("global.reset-text-size", "Reset Text Size", "Set text back to the default size", "text, font, size, reset, default, zoom", primary("0"), { group: "appearance" }),
  action("global.check-for-updates", "Check for updates…", "Check your channel for a newer build", "update, updates, version, release, nightly", primary("shift+u"), { group: "project" }),
  action("global.connections", "Connections…", "Switch or manage connections", "connection, connections, remote, local, service, switch", primary("9"), { group: "project" }),
  action("global.toggle-intercept", "Toggle Intercept", "Turn Intercept all on or off", "intercept, all, toggle, global", primary("i"), { group: "browser" }),
  ...pageActions("ledger.drawer-closed", [
    ["toggle-settings", "Toggle Query Fields", "Show or hide the query fields and examples", "settings, toggle, query, fields, help", primary("p")],
    ["focus-query", "Search", "Jump to search input", "search", primary("s"), { group: "focus" }],
    ["focus-exclusion", "Filter", "Open the Types menu and jump to its filter input", "filter, types, content type", primary("f"), { group: "focus" }],
    ["next-page", "Next", "Scroll the table down a page", "next, page down", primary("]")],
    ["previous-page", "Previous", "Scroll the table up a page", "previous, page up", primary("[")],
    ["open-request", "Open", "Open a request by its number", "open, number, go to", primary("shift+o")],
    ["toggle-sidebar", "Toggle Sitemap Sidebar", "Collapse or expand the sitemap sidebar", "sidebar, dock, sitemap, collapse, expand", primary("\\")],
    ["focus-sitemap", "Find in Sitemap", "Jump to the sitemap's find box, expanding the sidebar", "sitemap, find, search, host, path", primary("shift+\\"), { group: "focus" }],
  ]),
  ...pageActions("ledger.drawer-open.websocket", [
    ["open-stream", "Open WebSocket Stream", "Open the upgraded connection stream", "open websocket upgrade stream messages", primary("shift+g")],
  ]),
  ...pageActions("ledger.drawer-open", [
    // Search, Filter and Open request work with the drawer open too: it no
    // longer covers the table.
    ["focus-query", "Search", "Jump to search input", "search", primary("s"), { group: "focus" }],
    ["focus-exclusion", "Filter", "Open the Types menu and jump to its filter input", "filter, types, content type", primary("f"), { group: "focus" }],
    ["open-request", "Open", "Open a request by its number", "open, number, go to", primary("shift+o"), { group: "navigate" }],
    // By number across the project, whether the results hold the request or
    // not; ⌘[ / ⌘] go back to the results' lowest or highest number.
    ["next-request", "Next Request", "Open the request with the next number, in the results or not", "next, number", primary("shift+]"), { group: "navigate" }],
    ["first-result", "First Result", "Open the results' lowest-numbered request", "first, lowest, oldest, start, results", primary("["), { group: "navigate" }],
    ["last-result", "Last Result", "Open the results' highest-numbered request", "last, highest, newest, end, results", primary("]"), { group: "navigate" }],
    ["send-to-armory", "Send to Armory", "Create an Armory template from each selected request", "armory template request", primary("shift+a"), { group: "send" }],
    ["previous-request", "Previous Request", "Open the request with the previous number, in the results or not", "previous, number", primary("shift+["), { group: "navigate" }],
    ["send-to-launchpad", "Send to Launchpad", "Send the selected requests to a new launchpad", "launchpad", primary("shift+l"), { group: "send" }],
    ["create-test-case", "Create Test Case", "Create a new test case from the selected requests", "create,test,case", primary("shift+t"), { group: "logbook" }],
    ["link-test-case", "Link to Test Case", "Attach request to an existing test case", "link,attach,existing", primary("shift+b"), { group: "logbook" }],
    ["unlink-test-case", "Unlink Test Case", "Remove request from linked test case", "unlink test case", primary("shift+d"), { group: "logbook" }],
    ["create-finding", "Create Finding", "Create a new finding from the selected requests", "create,finding", primary("shift+f"), { group: "logbook" }],
    ["link-finding", "Link Finding", "Attach request to an existing finding", "link,attach,existing", primary("shift+k"), { group: "logbook" }],
    ["unlink-finding", "Unlink Finding", "Remove request from linked finding", "unlink test case", primary("shift+x"), { group: "logbook" }],
    ["view-note", "View Note", "View or modify request note", "note", primary("shift+n"), { group: "view" }],
    ["view-metadata", "View Metadata", "View metadata for this request", "metadata", primary("shift+m"), { group: "view" }],
    ["copy-url", "Copy URL", "Copy the selected requests' URLs", "request, url", primary("shift+c"), { group: "copy" }],
    ["copy-raw-request", "Copy Raw Request", "Copy the selected complete HTTP requests", "request, raw", primary("shift+r"), { group: "copy" }],
    ["copy-raw-response", "Copy Raw Response", "Copy the selected complete HTTP responses", "response, raw", primary("shift+s"), { group: "copy" }],
    ["copy-browser-view-url", "Copy Browser View URL", "Copy the URL that shows the request's stored response in a proxied browser", "browser, view, response, render, url", primary("shift+v"), { yieldsToEditors: true, group: "copy" }],
    ["open-row-menu", "Open Row Actions", "Open the context menu for the selected requests", "context, menu, actions, selection, right-click", primary("shift+."), { group: "navigate" }],
    ["toggle-fullscreen", "Toggle Fullscreen", "Expand or collapse the request drawer", "toggle, expand", primary("shift+e"), { group: "view" }],
    ["toggle-word-wrap", "Toggle Word Wrap", "Wrap request / response lines", "toggle, linewrap", primary("shift+w"), { group: "view" }],
    ["toggle-sidebar", "Toggle Sitemap Sidebar", "Collapse or expand the sitemap sidebar", "sidebar, dock, sitemap, collapse, expand", primary("\\"), { group: "view" }],
    ["focus-sitemap", "Find in Sitemap", "Jump to the sitemap's find box, expanding the sidebar", "sitemap, find, search, host, path", primary("shift+\\"), { group: "focus" }],
  ]),
  ...pageActions("armory.page", [
    ["toggle-settings", "Toggle Armory Settings", "Toggle attack configuration", "settings, toggle, configuration", primary("p")],
    ["next-template", "Next Template", "Select the next Armory template", "next template", primary("]"), { group: "templates" }],
    ["previous-template", "Previous Template", "Select the previous Armory template", "previous template", primary("["), { group: "templates" }],
    ["next-run", "Next Run", "Select the next run for this template", "next run", primary("shift+]"), { group: "runs" }],
    ["previous-run", "Previous Run", "Select the previous run for this template", "previous run", primary("shift+["), { group: "runs" }],
    ["open-first-request", "Open First Request", "Open the first request in the selected run", "open request drawer", primary("shift+o")],
    ["select-all-traffic", "Select All Traffic", "Select every request in the selected run's traffic", "select, all, traffic, requests", primary("a"), { yieldsToEditors: true }],
    ["edit-template", "Edit Armory Template", "Jump to the request template editor", "edit template request", primary("shift+e"), { group: "templates" }],
    ["create-template", "Create Armory Template", "Create a new request template", "create, new, template", primary("shift+t"), { group: "templates" }],
    ["save-template", "Save Armory Template", "Save the selected request template", "save, template", primary("shift+s"), { group: "templates" }],
    ["launch-run", "Launch Armory Run", "Save the template and start a run", "launch, start, run", primary("shift+l"), { group: "runs" }],
    ["cancel-run", "Cancel Armory Run", "Cancel the selected active run", "cancel, stop, run", primary("shift+c"), { group: "runs" }],
    ["refresh-runs", "Refresh Armory Runs", "Refresh run status", "refresh, runs, traffic", primary("shift+r"), { group: "runs" }],
  ]),
  ...pageActions("armory.drawer", [
    ["next-request", "Next Request", "Open the next request in this run", "next request", primary("shift+]")],
    ["previous-request", "Previous Request", "Open the previous request in this run", "previous request", primary("shift+[")],
  ]),
  // Ids predate the redesigned page (tabs, a settings accordion) and stay
  // put so saved profiles keep their overrides (docs/adr/2026-10-10-keybinding-profiles-override-factory-defaults.md).
  ...pageActions("launchpad", [
    ["toggle-settings", "Rename Launchpad", "Edit the launchpad's name and description", "rename, name, description, edit", primary("r"), { group: "view" }],
    ["next-tab", "Next Launchpad", "Open the next launchpad in the sidebar", "next, launchpad", primary("]"), { group: "navigate" }],
    ["previous-tab", "Previous Launchpad", "Open the previous launchpad in the sidebar", "previous, launchpad", primary("["), { group: "navigate" }],
    ["next-entry", "Next Entry", "Go to next Launchpad entry", "next, entry", primary("shift+]"), { group: "navigate" }],
    ["previous-entry", "Previous Entry", "Go to previous Launchpad entry", "previous, entry", primary("shift+["), { group: "navigate" }],
    ["delete-tab", "Delete Launchpad", "Delete the open launchpad", "delete, launchpad", primary("shift+d"), { group: "launch" }],
    ["edit-request", "Edit Request", "Edit Current Entry Request", "edit, entry, request", primary("shift+e"), { group: "launch" }],
    ["toggle-tls", "Toggle TLS", "Toggle TLS Flag", "toggle, tls, https", primary("shift+t"), { group: "launch" }],
    ["launch", "Launch", "Send request through proxy", "send, launchpad, repeat", primary("shift+l"), { group: "launch" }],
    ["cancel-launch", "Cancel Launch", "Cancel the open launchpad's pending launch", "cancel, stop, abort, launch", primary("shift+."), { group: "launch" }],
    ["view-notes", "View Notes", "View or edit request notes", "notes", primary("shift+n"), { group: "view" }],
    ["view-metadata", "View Metadata", "View request Metadata", "metadata", primary("shift+m"), { group: "view" }],
    ["copy-browser-view-url", "Copy Browser View URL", "Copy the URL that shows the open entry's stored response in a proxied browser", "browser, view, response, render, url", primary("shift+v"), { yieldsToEditors: true, group: "view" }],
    ["focus-search", "Search Launchpads", "Jump to the sidebar search", "search, find, filter", primary("shift+s"), { group: "navigate" }],
    ["create", "New Launchpad", "Create an empty launchpad", "new, create, add, launchpad", primary("shift+a"), { group: "launch" }],
    ["toggle-sidebar", "Toggle Launchpad Sidebar", "Collapse or expand the launchpad sidebar", "sidebar, dock, collapse, expand", primary("\\"), { group: "view" }],
    ["toggle-group-by-status", "Group by Status", "Group entries into status-code folders", "group, status, folders", primary("shift+g"), { group: "view" }],
    ["toggle-compare", "Compare Entries", "Compare two entries of the open launchpad, or stop comparing", "compare, diff", primary("shift+c"), { group: "compare" }],
    ["toggle-compare-view", "Switch Compare Request/Response", "Show the request or the response diff while comparing", "compare, diff, request, response", primary("shift+r"), { group: "compare" }],
    ["swap-compare", "Swap Compared Entries", "Swap the A and B entries while comparing", "compare, swap", primary("shift+x"), { group: "compare" }],
    ["jump-to-latest", "Jump to Last Entry", "Select the last entry in entry order and scroll the sidebar to it", "last, end, latest, bottom, jump, scroll, select", primary("shift+down"), { yieldsToEditors: true, group: "navigate" }],
  ]),
  // Esc, which collapses the entry selection, is reserved for the page
  // (gate.js), so the tree handles it itself.
  // The ⌥ arrows move the entry selection, as its context menu's Order
  // items do: ⌥ on both platforms, so not primary().
  ...pageActions("launchpad.tree", [
    ["select-all-entries", "Select All Entries", "Select every entry of the focused launchpad", "select, all, entries", primary("a"), { yieldsToEditors: true, group: "entries" }],
    ["move-entries-up", "Move Entries Up", "Move the selected entries above the entry before them", "move, up, order, reorder, entries", both("alt+arrowup"), { yieldsToEditors: true, group: "entries" }],
    ["move-entries-down", "Move Entries Down", "Move the selected entries below the entry after them", "move, down, order, reorder, entries", both("alt+arrowdown"), { yieldsToEditors: true, group: "entries" }],
    ["move-entries-top", "Move Entries to Top", "Move the selected entries to the start of their launchpad", "move, top, first, order, reorder, entries", both("alt+shift+arrowup"), { yieldsToEditors: true, group: "entries" }],
    ["move-entries-bottom", "Move Entries to Bottom", "Move the selected entries to the end of their launchpad", "move, bottom, last, end, order, reorder, entries", both("alt+shift+arrowdown"), { yieldsToEditors: true, group: "entries" }],
    // ⌘⇧T is the page's Toggle TLS, which is eligible with the tree.
    ["create-finding", "New Finding from Entries", "Create a new finding from the selected entries' requests", "create, new, finding, entries, requests", primary("shift+f"), { yieldsToEditors: true, group: "entries" }],
    ["create-test-case", "New Test Case from Entries", "Create a new test case from the selected entries' requests", "create, new, test, case, entries, requests", primary("shift+b"), { yieldsToEditors: true, group: "entries" }],
  ]),
  // Ids predate the redesigned page (a settings accordion) and stay put so
  // saved profiles keep their overrides; toggle-settings now switches the
  // workspace between Item and Rules.
  ...pageActions("checkpoint", [
    ["toggle-settings", "Toggle Rules", "Switch the workspace between the items and the rules", "rules, item, switch, lua, toggle", primary("p")],
    ["edit-rules", "Edit Rules", "Open the rules and focus their editor", "rules, lua, code, edit", primary("shift+e"), { group: "rules" }],
    ["update-rules", "Update Rules", "Apply the rules", "rules, lua, code, apply, run", primary("shift+r"), { group: "rules" }],
    ["edit-intercepted", "Edit Intercepted Item", "Focus the selected item's intercepted side", "intercept, edit, focus", primary("shift+i"), { group: "held" }],
    ["forward-intercepted", "Forward Intercepted Item", "Forward the selected item", "forward, intercept", primary("shift+f"), { group: "held" }],
    ["drop-intercepted", "Drop Intercepted Item", "Drop the selected item", "drop, intercept", primary("shift+d"), { group: "held" }],
    // The dock's Forward n and Drop n: the picked items, or every item when
    // none are picked.
    ["forward-picked", "Forward Picked Items", "Forward the picked items, or every item when none are picked", "forward, bulk, picked, all, intercept", primary("shift+a"), { group: "held" }],
    ["drop-picked", "Drop Picked Items", "Drop the picked items, or every item when none are picked", "drop, bulk, picked, all, intercept", primary("shift+x"), { group: "held" }],
    ["forward-intercept-response", "Forward + Intercept Response", "Forward the selected request and intercept its response", "forward, intercept, response", primary("shift+s"), { group: "held" }],
    ["show-logs", "Show Logs", "Show Extension Logs", "logs, lua", primary("shift+l")],
  ]),
  // Esc, which goes back to the list, is reserved for the page (gate.js),
  // so the page handles it itself. It has no action: one without a default
  // key would show as unbound in the factory profile. N is unmodified, so
  // it never runs while a field or editor has focus.
  ...pageActions("logbook", [
    ["focus-search", "Search Logbook", "Jump to search input", "search", primary("shift+s")],
    ["create-finding", "Create Finding", "Create a new draft finding", "create, new, finding", primary("shift+f")],
    ["create-test-case", "Create Test Case", "Draft a new blank test case", "create, new, test, case", primary("shift+t")],
    ["export-report", "Export Report", "Create a report from logbook", "report, template, findings", primary("shift+e")],
    ["next-record", "Next Record", "Open the next record in the list", "next, record, finding, test, case", both("n")],
  ]),
  ...pageActions("compass", [
    ["toggle-settings", "Toggle Compass Settings", "Toggle Settings Accordian", "settings, toggle", primary("p")],
    ["update-rules", "Update Compass Code", "Execute compass code", "compass, toggle", primary("shift+r")],
    ["edit-rules", "Edit Compass", "Jump to Code Editor", "code, editor", primary("shift+e")],
    ["show-logs", "Show Logs", "Show Extension Logs", "logs, lua", primary("shift+l")],
  ]),
  ...pageActions("workshop", [
    ["toggle-settings", "Toggle Workshop Settings", "Toggle Settings Accordian", "settings, toggle", primary("p")],
    ["edit-code", "Edit Workshop", "Jump to code editor", "edit, code", primary("shift+e")],
    ["update-code", "Update Workshop", "Execute Workshop Code", "execute, code", primary("shift+r")],
    ["show-logs", "Show Logs", "Show Extension Logs", "logs, lua", primary("shift+l")],
  ]),
  ...pageActions("websocket", [
    ["previous-tab", "Previous WebSocket Tab", "Move to the previous WebSocket tab", "websocket previous tab stream checkpoint inject connection", primary("[")],
    ["next-tab", "Next WebSocket Tab", "Move to the next WebSocket tab", "websocket next tab stream checkpoint inject connection", primary("]")],
    ["close-connection", "Close WebSocket Connection", "Close the active WebSocket connection", "websocket close disconnect", primary("shift+x")],
  ]),
  ...pageActions("websocket.stream", [
    ["previous-frame", "Previous WebSocket Message", "Select the previous message in the stream", "websocket previous message", primary("shift+[")],
    ["next-frame", "Next WebSocket Message", "Select the next message in the stream", "websocket next message", primary("shift+]")],
    ["jump-to-bottom", "Jump to Bottom", "Jump to the newest message and resume auto-scroll", "websocket stream bottom newest follow auto-scroll", primary("shift+down")],
    ["toggle-frame-metadata", "Toggle Message Metadata", "Switch between the message payload and metadata", "websocket message metadata payload", primary("shift+m")],
    ["copy-frame-to-inject", "Copy Message to Inject", "Copy the selected message into the Inject tab", "websocket message copy inject", primary("shift+i")],
  ]),
  ...pageActions("websocket.checkpoint", [
    ["toggle-intercept", "Toggle WebSocket Intercept", "Enable or disable WebSocket interception", "websocket checkpoint intercept toggle", primary("shift+i")],
    ["forward-frame", "Forward WebSocket Message", "Forward the current intercepted message", "websocket checkpoint forward message", primary("shift+f")],
    ["drop-frame", "Drop WebSocket Message", "Drop the current intercepted message", "websocket checkpoint drop message", primary("shift+d")],
  ]),
  ...pageActions("websocket.inject", [
    ["toggle-direction", "Toggle Inject Direction", "Switch the injected message direction", "websocket inject direction client server", primary("shift+d")],
    ["cycle-opcode", "Cycle Inject Opcode", "Select the next WebSocket opcode", "websocket inject opcode cycle", primary("shift+o")],
    ["inject-frame", "Inject WebSocket Message", "Inject the current message into the connection", "websocket inject send message", primary("shift+enter")],
  ]),
];

// Lowercase dot/dash-safe slug used inside action ids.
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Compass and Checkpoint are extensions with their own navigation actions.
const BUILT_IN_EXTENSIONS = new Set(["compass", "checkpoint"]);

// Extension action ids. Each prefix belongs to one kind of action, so an
// extension can never declare an id Marasi uses for it:
// - global.open-extension.<extension>: Marasi's navigation to its page;
// - extension-page.<extension>.<slug>: Marasi's own actions on that page
//   (and the page's menu context id is extension-page.<extension>);
// - extension.<extension>.<declared action>: actions the extension declares.
// <extension> is the slug of the extension name (stable across projects,
// unlike its per-project ID); nothing uses list positions.
export function extensionNavigationActionId(extensionName) {
  return `global.open-extension.${slugify(extensionName)}`;
}

export function extensionPageContextId(extensionName) {
  return `extension-page.${slugify(extensionName)}`;
}

export function extensionPageActionId(extensionName, slug) {
  return `${extensionPageContextId(extensionName)}.${slug}`;
}

export function extensionMenuActionId(extensionName, declaredAction) {
  const slug = slugify(declaredAction ?? "");
  return slug ? `extension.${slugify(extensionName)}.${slug}` : null;
}

// GUI targets an extension renders that persist (toasts do not). Only an
// extension that rendered one has a page worth opening: every extension is
// a Lua script, and Workshop, for one, has its own core page and would
// otherwise appear twice.
const GUI_TARGETS = ["icon", "main", "panel", "menu"];

// The loaded extensions that rendered a GUI, in load order. `extensionsUI`
// is the per-extension store of rendered targets.
export function extensionsWithGUI(extensions = [], extensionsUI = {}) {
  return extensions.filter((extension) =>
    GUI_TARGETS.some((target) => extensionsUI?.[extension?.Name]?.[target] != null),
  );
}

// Extensions with a page and a navigation action, in load order. Names whose
// slug is empty or already taken keep only the first extension.
function navigableExtensions(extensions) {
  const seen = new Set();
  return extensions.filter((extension) => {
    const slug = slugify(extension?.Name ?? "");
    if (!slug || BUILT_IN_EXTENSIONS.has(extension.Name) || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

// Opening an extension page from the global menu. Identity comes from the
// extension name; the factory default keeps today's positional ⌘⌥1–9
// (Ctrl+Alt+1–9) taken from the current extension order, so a persisted
// override (keyed by id) never moves to another extension when the order
// changes. Extensions past the ninth have no default. These defaults are
// marked `positionalDefault`: they move with the order, so an inherited one
// yields to any binding that collides with it (see createKeymap).
export function extensionNavigationActions(extensions = []) {
  return navigableExtensions(extensions).map((extension, index) =>
    action(
      extensionNavigationActionId(extension.Name),
      extension.Name,
      `Open ${extension.Name}`,
      `${extension.Name}`,
      index < 9 ? primary(`alt+${index + 1}`) : { [MACOS]: [], [WINDOWS_LINUX]: [] },
      { positionalDefault: true, group: "go" },
    ),
  );
}

// An extension menu item's `keys`: `[mac, windows/linux]`, or one string in
// hotkeys-js notation ("⌘+⇧+V, ctrl+⇧+V") used on both platforms, as before.
// Entries that do not parse are dropped: extension data never breaks the
// catalog.
function extensionItemDefaults(keys) {
  const parse = (list) =>
    list.map((text) => (typeof text === "string" ? normalizeBinding(text) : null)).filter(Boolean);
  if (Array.isArray(keys)) {
    return { [MACOS]: parse(keys.slice(0, 1)), [WINDOWS_LINUX]: parse(keys.slice(1, 2)) };
  }
  if (typeof keys !== "string") return { [MACOS]: [], [WINDOWS_LINUX]: [] };
  // hotkeys-js splits on commas; an empty piece is the "," key itself.
  const pieces = [];
  for (const piece of keys.replace(/\s/g, "").split(",")) {
    if (piece === "" && pieces.length) pieces[pieces.length - 1] += ",";
    else if (piece !== "") pieces.push(piece);
  }
  const both = [...new Set(parse(pieces))];
  return { [MACOS]: both, [WINDOWS_LINUX]: [...both] };
}

// Factory defaults must form a valid profile (see validateProfile in
// profiles.js; the menu tests check the real catalog), and extension
// data must not break that: an extension default is dropped when it is a
// reserved key, opens the Marasi menu, or is already bound on the same page
// (Toggle Settings or an earlier item). The action stays, unbound for that
// key; the researcher can bind it.
function takenOnExtensionPage(toggleSettings) {
  const menu = FACTORY_ACTIONS.find((a) => a.id === OPEN_MENU);
  return Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      new Set(
        [...menu.defaults[platform], ...toggleSettings.defaults[platform]].map(normalizeBinding),
      ),
    ]),
  );
}

function claimDefaults(defaults, taken) {
  const claimed = {};
  for (const platform of PLATFORMS) {
    claimed[platform] = defaults[platform].filter(
      (binding) => !isReservedBinding(binding) && !taken[platform].has(binding),
    );
    claimed[platform].forEach((binding) => taken[platform].add(binding));
  }
  return claimed;
}

// Each extension page's menu: Marasi's Toggle Settings, then the actions the
// extension declares with `marasi:render("menu", ...)`. `menus` maps an
// extension name to its rendered menu items. A declared action's identity is
// its `action` (the Lua function it calls); items without one run nothing
// and are not catalog actions. A repeated action slug keeps the first item.
export function extensionPageMenus(extensions = [], menus = {}) {
  const contexts = [];
  const actions = [];
  for (const extension of navigableExtensions(extensions)) {
    const name = extension.Name;
    const context = extensionPageContextId(name);
    contexts.push(extensionPageContext(context, name));
    actions.push(
      action(
        extensionPageActionId(name, "toggle-settings"),
        `Toggle ${name} Settings`,
        "Toggle Settings Accordian",
        "settings, toggle",
        primary("p"),
        { context },
      ),
    );
    const items = Array.isArray(menus?.[name]) ? menus[name] : [];
    const seen = new Set();
    const taken = takenOnExtensionPage(actions.at(-1));
    for (const item of items) {
      const id = extensionMenuActionId(name, typeof item?.action === "string" ? item.action : "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      actions.push(
        action(
          id,
          String(item.name ?? item.action),
          String(item.subtitle ?? ""),
          String(item.keywords ?? ""),
          claimDefaults(extensionItemDefaults(item.keys), taken),
          { context },
        ),
      );
    }
  }
  return { contexts, actions };
}

export function createCatalog(definitions, { contexts = CONTEXTS, groups = FACTORY_MENU_GROUPS } = {}) {
  const contextIds = new Set(contexts.map((context) => context.id));
  const groupKey = (context, id) => `${context}\u0000${id}`;
  const groupsByKey = new Map(groups.map((g) => [groupKey(g.context, g.id), g]));
  const byId = new Map();
  for (const definition of definitions) {
    if (!ACTION_ID.test(definition.id)) {
      throw new Error(`invalid menu action id: ${definition.id}`);
    }
    if (byId.has(definition.id)) {
      throw new Error(`duplicate menu action id: ${definition.id}`);
    }
    if (!contextIds.has(definition.context)) {
      throw new Error(`unknown menu context ${definition.context} for ${definition.id}`);
    }
    if (definition.group && !groupsByKey.has(groupKey(definition.context, definition.group))) {
      throw new Error(`unknown menu group ${definition.group} for ${definition.id}`);
    }
    const defaults = {};
    for (const platform of PLATFORMS) {
      defaults[platform] = (definition.defaults?.[platform] ?? []).map((text) => {
        const binding = normalizeBinding(text);
        if (!binding) throw new Error(`invalid default binding ${text} for ${definition.id}`);
        return binding;
      });
    }
    byId.set(definition.id, Object.freeze({ ...definition, defaults: Object.freeze(defaults) }));
  }
  const actions = Object.freeze([...byId.values()]);
  return {
    actions,
    contexts,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    inContext: (contextId) => actions.filter((a) => a.context === contextId),
    // Menu groups (menuGroups.js), in catalog order.
    groups,
    group: (contextId, id) => groupsByKey.get(groupKey(contextId, id)),
    groupsIn: (contextId) => groups.filter((g) => g.context === contextId),
  };
}

// The app's catalog: factory actions plus actions derived from app data
// (the loaded extensions and the menus their pages have rendered).
export function buildCatalog({ extensions = [], extensionMenus = {} } = {}) {
  const pages = extensionPageMenus(extensions, extensionMenus);
  return createCatalog(
    [...FACTORY_ACTIONS, ...extensionNavigationActions(extensions), ...pages.actions],
    { contexts: [...CONTEXTS, ...pages.contexts] },
  );
}
