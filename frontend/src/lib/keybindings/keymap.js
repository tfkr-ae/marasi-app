import { normalizeBinding } from "./keys.js";

export const OPEN_MENU = "global.open-menu";

function normalizedList(texts) {
  const bindings = [];
  for (const text of texts ?? []) {
    const binding = normalizeBinding(text);
    if (binding && !bindings.includes(binding)) bindings.push(binding);
  }
  return bindings;
}

// The resolved bindings of one platform variant: each catalog action's
// factory defaults, replaced by `overrides[actionId]` when present. An
// override is the complete binding list for that action (an empty list means
// intentionally unbound); a missing override inherits the defaults.
// Overrides for ids that are not in the catalog are ignored here (they are
// dormant data, not executable actions).
//
// `knownActions` (a profile's known action ids) enables the new-default rule
// of ADR 0001: an action the profile does not know yet inherits its defaults
// only when none collides with a customization (an overridden action in the
// same context, or an overridden menu opening); otherwise it is unbound and
// the customization wins. Without `knownActions` every action inherits.
// Mirrors resolveVariant in keybinding_validation.go.
export function createKeymap(catalog, platform, overrides = {}, { knownActions } = {}) {
  const known = knownActions ? new Set(knownActions) : null;
  const customized = new Map(); // binding -> overridden catalog actions
  for (const [id, texts] of Object.entries(overrides)) {
    const action = catalog.get(id);
    if (!action) continue;
    for (const binding of normalizedList(texts)) {
      if (!customized.has(binding)) customized.set(binding, []);
      customized.get(binding).push(action);
    }
  }
  const collides = (action, bindings) =>
    bindings.some((binding) =>
      (customized.get(binding) ?? []).some(
        (other) => other.context === action.context || other.id === OPEN_MENU,
      ),
    );

  const bindingsById = new Map();
  const actionsByBinding = new Map();
  for (const action of catalog.actions) {
    let bindings;
    if (Object.hasOwn(overrides, action.id)) {
      bindings = normalizedList(overrides[action.id]);
    } else {
      bindings = normalizedList(action.defaults[platform]);
      if (known && !known.has(action.id) && collides(action, bindings)) bindings = [];
    }
    bindingsById.set(action.id, bindings);
    for (const binding of bindings) {
      if (!actionsByBinding.has(binding)) actionsByBinding.set(binding, []);
      actionsByBinding.get(binding).push(action.id);
    }
  }
  return {
    platform,
    catalog,
    bindingsFor: (actionId) => bindingsById.get(actionId) ?? [],
    // Every action bound to `binding`, in catalog order, across all contexts.
    actionsFor: (binding) => actionsByBinding.get(binding) ?? [],
  };
}
