import { contextsConflict } from "./contexts.js";
import { isReservedBinding, reservedBindingProblem } from "./gate.js";
import { normalizeBinding } from "./keys.js";
import { createKeymap, OPEN_MENU } from "./keymap.js";
import { PLATFORMS } from "./platform.js";

// Keybinding profiles (ADR 0001), independent of where they are stored:
// the app config (GetKeybindings/SaveKeybindings) and profile files
// (portable.js, docs/keybinding-profile-format.md) use this same shape.
//
//   config  = { version, activeProfile, profiles: [profile] }
//   profile = { id, name, overrides: { macos: [o], "windows-linux": [o] }, knownActions: [id] }
//   o       = { action: <action id>, keys: [<binding>] }   // keys: [] = unbound
//
// A missing override inherits the factory default. knownActions lists the
// catalog actions the profile was last saved against; see createKeymap for
// the new-default rule. Overrides for ids missing from the catalog are
// dormant: kept, never executed. Validation mirrors
// keybinding_validation.go, which checks every save against the catalog the
// frontend sends (catalogDescriptor).

export const KEYBINDINGS_VERSION = 1;

export function factoryProfile(id = "default", name = "Default") {
  return {
    id,
    name,
    overrides: Object.fromEntries(PLATFORMS.map((platform) => [platform, []])),
    knownActions: [],
  };
}

export function factoryKeybindings() {
  return { version: KEYBINDINGS_VERSION, activeProfile: "default", profiles: [factoryProfile()] };
}

export function activeProfile(config) {
  return config?.profiles?.find((profile) => profile.id === config.activeProfile) ?? null;
}

// One variant's overrides as { [actionId]: keys }, the shape createKeymap takes.
export function variantOverrides(profile, platform) {
  return Object.fromEntries((profile?.overrides?.[platform] ?? []).map(({ action, keys }) => [action, keys]));
}

export function profileKeymap(catalog, profile, platform) {
  return createKeymap(catalog, platform, variantOverrides(profile, platform), {
    knownActions: profile?.knownActions ?? [],
  });
}

function problem(profile, platform, kind, actions, binding, message) {
  return {
    profileId: profile.id,
    profileName: profile.name,
    platform,
    kind,
    actions,
    binding,
    message: `${profile.name} (${platform}): ${message}`,
  };
}

// Problems in one profile, per platform variant, in a stable order:
//   menu-unbound   the menu opening has no binding
//   reserved       Escape/Tab/Enter (optionally with Shift) is assigned
//   duplicate      two actions share a binding in the same menu context or
//                  in overlapping contexts (contextsConflict)
//   menu-shadowed  an action in another context shares a menu-opening
//                  binding (the global context is always eligible, so it
//                  would win wherever that context is)
export function validateProfile(catalog, profile) {
  const problems = [];
  for (const platform of PLATFORMS) {
    const keymap = profileKeymap(catalog, profile, platform);
    if (keymap.bindingsFor(OPEN_MENU).length === 0) {
      problems.push(problem(profile, platform, "menu-unbound", [OPEN_MENU], null, "menu opening is unbound"));
    }
    for (const { action, keys } of profile.overrides?.[platform] ?? []) {
      for (const text of keys ?? []) {
        const binding = normalizeBinding(text);
        if (binding && isReservedBinding(binding)) {
          problems.push(problem(profile, platform, "reserved", [action], binding, reservedBindingProblem(binding)));
        }
      }
    }
    const reported = new Set();
    for (const action of catalog.actions) {
      for (const binding of keymap.bindingsFor(action.id)) {
        if (reported.has(binding)) continue;
        reported.add(binding);
        const owners = keymap.actionsFor(binding).map((id) => catalog.get(id));
        owners.forEach((first, i) => {
          for (const second of owners.slice(i + 1)) {
            if (contextsConflict(catalog.contexts, first.context, second.context)) {
              problems.push(
                problem(profile, platform, "duplicate", [first.id, second.id], binding, `${binding} is bound to both ${first.id} (${first.context}) and ${second.id} (${second.context})`),
              );
            }
          }
        });
        if (owners.some((owner) => owner.id === OPEN_MENU)) {
          const shadows = owners.filter((owner) => owner.context !== "global");
          if (shadows.length) {
            problems.push(
              problem(profile, platform, "menu-shadowed", [OPEN_MENU, ...shadows.map((a) => a.id)], binding, `${binding} opens the menu but ${shadows.map((a) => a.id).join(", ")} shadows it`),
            );
          }
        }
      }
    }
  }
  return problems;
}

// Records the new-default decisions against `catalog`: actions the rule left
// unbound get an explicit empty override, and every catalog action becomes
// known. A yielded positional default is not recorded: it is decided again on
// every resolution (see createKeymap). Returns a new profile. Mirrors
// settleKeybindings in Go, which runs on every save; the Settings draft should
// settle on open so edits are judged against known actions.
export function settleProfile(catalog, profile) {
  const overrides = {};
  for (const platform of PLATFORMS) {
    const keymap = profileKeymap(catalog, profile, platform);
    const list = (profile.overrides?.[platform] ?? []).map((o) => ({ action: o.action, keys: [...o.keys] }));
    for (const action of catalog.actions) {
      const overridden = list.some((o) => o.action === action.id);
      if (
        !overridden &&
        !action.positionalDefault &&
        keymap.bindingsFor(action.id).length === 0 &&
        action.defaults[platform].length > 0
      ) {
        list.push({ action: action.id, keys: [] });
      }
    }
    overrides[platform] = list;
  }
  const knownActions = [...new Set([...(profile.knownActions ?? []), ...catalog.actions.map((a) => a.id)])].sort();
  return { ...profile, overrides, knownActions };
}

// The catalog as SaveKeybindings expects it (main.KeybindingCatalog): the
// backend cannot import the JS catalog, so every save describes it.
export function catalogDescriptor(catalog) {
  return {
    actions: catalog.actions.map((action) => ({
      id: action.id,
      context: action.context,
      defaults: Object.fromEntries(PLATFORMS.map((platform) => [platform, [...action.defaults[platform]]])),
      positionalDefault: Boolean(action.positionalDefault),
    })),
    contexts: catalog.contexts.map((context) => ({ id: context.id, overlaps: [...(context.overlaps ?? [])] })),
  };
}

// What the dispatcher runs for the saved state from GetKeybindings
// ({ config, problem }): the active profile's variant for `platform`, or the
// factory bindings with a problem when the saved section is unusable or this
// variant would strand the menu or hold conflicts.
export function liveKeybindings(state, catalog, platform) {
  const factory = { overrides: {}, knownActions: undefined };
  if (!state?.config) return { ...factory, problem: "" };
  if (state.problem) return { ...factory, problem: state.problem };
  const profile = activeProfile(state.config);
  if (!profile) {
    return { ...factory, problem: `active keybinding profile ${state.config.activeProfile} does not exist` };
  }
  const problems = validateProfile(catalog, profile).filter((p) => p.platform === platform);
  if (problems.length) {
    return { ...factory, problem: `${problems.map((p) => p.message).join("; ")}. Using factory shortcuts.` };
  }
  return {
    overrides: variantOverrides(profile, platform),
    knownActions: profile.knownActions ?? [],
    problem: "",
  };
}
