import { CONTEXTS } from "./contexts.js";
import { normalizeBinding } from "./keys.js";
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

function action(id, label, description, keywords, defaults, context = "global") {
  return { id, context, label, description, keywords, defaults };
}

// One page or drawer menu: each action's id is `<context>.<slug>`, so ids
// stay unique when a key or label is reused in a mutually exclusive state.
function pageActions(context, rows) {
  return rows.map(([slug, label, description, keywords, defaults]) =>
    action(`${context}.${slug}`, label, description, keywords, defaults, context),
  );
}

export const FACTORY_ACTIONS = [
  action("global.open-menu", "Open Marasi Menu", "Open or close the Marasi menu", "menu, commands, palette", primary("k")),
  action("global.go-home", "Marasi", "Dashboard", "home, dashboard", primary("1")),
  action("global.go-ledger", "Ledger", "View requests", "ledger", primary("2")),
  action("global.go-compass", "Compass", "Configure scope", "compass", primary("3")),
  action("global.go-checkpoint", "Checkpoint", "Intercept Requests", "checkpoint", primary("4")),
  action("global.go-launchpad", "Launchpad", "Edit and Repeat Requests", "Launchpad", primary("5")),
  action("global.go-armory", "Armory", "Create request templates", "armory,template,attack", primary("6")),
  action("global.go-logbook", "Logbook", "Review test cases and findings", "logbook,findings,tests", primary("7")),
  action("global.go-workshop", "Workshop", "Extend Marasi", "Workshop", primary("8")),
  action("global.go-settings", "Settings", "Configure your settings", "settings", primary("s")),
  action("global.start-chrome", "Start Chrome", "Start Browser", "Chrome", primary("`")),
  action("global.download-certificate", "Download Certificate", "Download Certificate", "certificate,download", primary("d")),
  action("global.copy-certificate", "Copy Certificate", "Copy Certificate", "certificate,copy", primary(",")),
  action("global.jump-to-toast", "Jump to Toast", "Jump to the active toast", "toast", primary(".")),
  action("global.open-project", "Open Project", "Open a project", "open project", primary("o")),
  action("global.setup-listener", "Setup Listener", "Start a new listener", "listener", primary("l")),
  action("global.toggle-vim", "Toggle Vim Mode", "Toggle Vim Mode in editor views", "vim", primary("t")),
  action("global.toggle-light-mode", "Toggle Light Mode", "Switch between light and dark mode", "theme, light, dark, mode, ui", primary("u")),
  action("global.toggle-intercept", "Toggle Intercept", "Toggle the Global Intercept On or Off", "intercept, toggle, global", primary("i")),
  ...pageActions("ledger.drawer-closed", [
    ["toggle-settings", "Toggle Ledger Settings", "Toggle Settings Accordian", "settings, toggle", primary("p")],
    ["focus-query", "Search", "Jump to search input", "search", primary("shift+s")],
    ["focus-exclusion", "Filter", "Jump to filter input", "filter", primary("shift+f")],
    ["next-page", "Next", "Go to next page", "next", primary("]")],
    ["previous-page", "Previous", "Go to the previous page", "previous", primary("[")],
    ["open-request", "Open", "Open Request Drawer", "open", primary("shift+o")],
  ]),
  ...pageActions("ledger.drawer-open.websocket", [
    ["open-stream", "Open WebSocket Stream", "Open the upgraded connection stream", "open websocket upgrade stream frames", primary("shift+o")],
  ]),
  ...pageActions("ledger.drawer-open", [
    ["next-request", "Next Request", "Jump to the next item in the table", "next", primary("shift+]")],
    ["send-to-armory", "Send to Armory", "Create an Armory template from this request", "armory template request", primary("shift+a")],
    ["previous-request", "Previous Request", "Jump to the previous item in the table", "previous", primary("shift+[")],
    ["send-to-launchpad", "Send to Launchpad", "Open this request in the launchpad editor", "launchpad", primary("shift+l")],
    ["create-test-case", "Create Test Case", "Create a new test case from this request", "create,test,case", primary("shift+t")],
    ["link-test-case", "Link to Test Case", "Attach request to an existing test case", "link,attach,existing", primary("shift+b")],
    ["unlink-test-case", "Unlink Test Case", "Remove request from linked test case", "unlink test case", primary("shift+d")],
    ["create-finding", "Create Finding", "Create a new finding from this request", "create,finding", primary("shift+f")],
    ["link-finding", "Link Finding", "Attach request to an existing finding", "link,attach,existing", primary("shift+k")],
    ["unlink-finding", "Unlink Finding", "Remove request from linked finding", "unlink test case", primary("shift+x")],
    ["view-note", "View Note", "View or modify request note", "note", primary("shift+n")],
    ["view-metadata", "View Metadata", "View metadata for this request", "metadata", primary("shift+m")],
    ["copy-url", "Copy URL", "Copy the request URL", "request, url", primary("shift+u")],
    ["copy-raw-request", "Copy Raw Request", "Copy the complete HTTP request", "request, raw", primary("shift+r")],
    ["copy-raw-response", "Copy Raw Response", "Copy the complete HTTP response", "response, raw", primary("shift+s")],
    ["toggle-fullscreen", "Toggle Fullscreen", "Expand or collapse the request drawer", "toggle, expand", primary("shift+e")],
    ["toggle-word-wrap", "Toggle Word Wrap", "Wrap request / response lines", "toggle, linewrap", primary("shift+w")],
  ]),
  ...pageActions("armory.page", [
    ["toggle-settings", "Toggle Armory Settings", "Toggle attack configuration", "settings, toggle, configuration", primary("p")],
    ["next-template", "Next Template", "Select the next Armory template", "next template", primary("]")],
    ["previous-template", "Previous Template", "Select the previous Armory template", "previous template", primary("[")],
    ["next-run", "Next Run", "Select the next run for this template", "next run", primary("shift+]")],
    ["previous-run", "Previous Run", "Select the previous run for this template", "previous run", primary("shift+[")],
    ["open-first-request", "Open First Request", "Open the first request in the selected run", "open request drawer", primary("shift+o")],
    ["edit-template", "Edit Armory Template", "Jump to the request template editor", "edit template request", primary("shift+e")],
    ["create-template", "Create Armory Template", "Create a new request template", "create, new, template", primary("shift+t")],
    ["save-template", "Save Armory Template", "Save the selected request template", "save, template", primary("shift+s")],
    ["launch-run", "Launch Armory Run", "Save the template and start a run", "launch, start, run", primary("shift+l")],
    ["cancel-run", "Cancel Armory Run", "Cancel the selected active run", "cancel, stop, run", primary("shift+c")],
    ["refresh-runs", "Refresh Armory Runs", "Refresh run status", "refresh, runs, traffic", primary("shift+r")],
  ]),
  ...pageActions("armory.drawer", [
    ["next-request", "Next Request", "Open the next request in this run", "next request", primary("shift+]")],
    ["previous-request", "Previous Request", "Open the previous request in this run", "previous request", primary("shift+[")],
  ]),
  ...pageActions("launchpad", [
    ["toggle-settings", "Toggle Launchpad Settings", "Toggle Settings Accordian", "settings, toggle", primary("p")],
    ["next-tab", "Next Tab", "Go to next Launchpad tab", "next, tab", primary("]")],
    ["previous-tab", "Previous Tab", "Go to previous Launchpad tab", "previous, tab", primary("[")],
    ["next-entry", "Next Entry", "Go to next Launchpad entry", "next, entry, tab", primary("shift+]")],
    ["previous-entry", "Previous Entry", "Go to previous Launchpad entry", "previous, entry, tab", primary("shift+[")],
    ["delete-tab", "Delete Tab", "Delete Current Launchpad Tab", "delete, tab", primary("shift+d")],
    ["edit-request", "Edit Request", "Edit Current Entry Request", "edit, entry, request", primary("shift+e")],
    ["toggle-tls", "Toggle TLS", "Toggle TLS Flag", "toggle, tls, https", primary("shift+t")],
    ["launch", "Launch", "Send request through proxy", "send, launchpad, repeat", primary("shift+l")],
    ["view-notes", "View Notes", "View or edit request notes", "notes", primary("shift+n")],
    ["view-metadata", "View Metadata", "View request Metadata", "metadata", primary("shift+m")],
  ]),
  ...pageActions("checkpoint", [
    ["toggle-settings", "Toggle Checkpoint Settings", "Toggle Settings Accordian", "settings, toggle", primary("p")],
    ["edit-rules", "Edit Checkpoint", "Jump to code editor", "edit, toggle", primary("shift+e")],
    ["update-rules", "Update Checkpoint Code", "Execute Checkpoint code", "edit, toggle", primary("shift+r")],
    ["edit-intercepted", "Edit Intercepted Item", "Jump to intercepted item editor", "intercept, toggle", primary("shift+i")],
    ["forward-intercepted", "Forward Intercepted Item", "Forward current item", "forward, toggle", primary("shift+f")],
    ["drop-intercepted", "Drop Intercepted Item", "Drop current item", "drop, toggle", primary("shift+d")],
    ["show-logs", "Show Logs", "Show Extension Logs", "logs, lua", primary("shift+l")],
  ]),
  ...pageActions("logbook", [
    ["toggle-settings", "Toggle Logbook Settings", "Toggle Settings Accordian", "settings, toggle", primary("p")],
    ["focus-search", "Search Logbook", "Jump to search input", "search", primary("shift+s")],
    ["create-finding", "Create Finding", "Create a new draft finding", "create, new, finding", primary("shift+f")],
    ["create-test-case", "Create Test Case", "Draft a new blank test case", "create, new, test, case", primary("shift+t")],
    ["export-report", "Export Report", "Create a report from logbook", "report, template, findings", primary("shift+e")],
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

export function extensionNavigationActionId(extensionName) {
  return `global.open-extension.${slugify(extensionName)}`;
}

// Opening an extension page from the global menu. Identity comes from the
// extension name; the factory default keeps today's positional ⌘⌥1–9
// (Ctrl+Alt+1–9) taken from the current extension order, so a persisted
// override (keyed by id) never moves to another extension when the order
// changes. Extensions past the ninth have no default.
export function extensionNavigationActions(extensions = []) {
  const seen = new Set();
  const navigable = extensions.filter((extension) => {
    const id = extensionNavigationActionId(extension.Name);
    if (BUILT_IN_EXTENSIONS.has(extension.Name) || !slugify(extension.Name) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  return navigable.map((extension, index) =>
    action(
      extensionNavigationActionId(extension.Name),
      extension.Name,
      `Open ${extension.Name}`,
      `${extension.Name}`,
      index < 9 ? primary(`alt+${index + 1}`) : { [MACOS]: [], [WINDOWS_LINUX]: [] },
    ),
  );
}

export function createCatalog(definitions, { contexts = CONTEXTS } = {}) {
  const contextIds = new Set(contexts.map((context) => context.id));
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
  };
}

// The app's catalog: factory actions plus actions derived from app data
// (currently the loaded extensions).
export function buildCatalog({ extensions = [] } = {}) {
  return createCatalog([...FACTORY_ACTIONS, ...extensionNavigationActions(extensions)]);
}
