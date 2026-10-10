import { normalizeBinding } from "./keys.js";

// The resolved bindings of one platform variant: each catalog action's
// factory defaults, replaced by `overrides[actionId]` when present. An
// override is the complete binding list for that action (an empty list means
// intentionally unbound); a missing override inherits the defaults.
// Overrides for ids that are not in the catalog are ignored here (they are
// dormant data, not executable actions). Ticket 05 derives `overrides` from
// the active profile.
export function createKeymap(catalog, platform, overrides = {}) {
  const bindingsById = new Map();
  const actionsByBinding = new Map();
  for (const action of catalog.actions) {
    const source = Object.hasOwn(overrides, action.id)
      ? overrides[action.id]
      : action.defaults[platform];
    const bindings = [];
    for (const text of source ?? []) {
      const binding = normalizeBinding(text);
      if (binding && !bindings.includes(binding)) bindings.push(binding);
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
