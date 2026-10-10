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
