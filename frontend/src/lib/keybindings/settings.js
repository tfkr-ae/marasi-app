import { contextsConflict } from "./contexts.js";
import { isReservedBinding } from "./gate.js";
import { bindingFromEvent, formatBinding, normalizeBinding } from "./keys.js";
import { OPEN_MENU } from "./keymap.js";
import { PLATFORM_NAMES } from "./platform.js";
import {
  catalogDescriptor,
  factoryKeybindings,
  profileKeymap,
  settleProfile,
  validateProfile,
} from "./profiles.js";

// The keybinding settings modal's model, independent of Svelte. The modal
// edits a draft: a whole keybinding config ({ version, activeProfile,
// profiles }, see profiles.js) that is persisted only by Save. Every edit
// returns a new draft; nothing here mutates its input.

function copyConfig(config) {
  return structuredClone(config);
}

// The draft for the saved state from GetKeybindings ({ config, problem }).
// Every profile is settled against `catalog` (ADR 0001), so the draft shows
// the new-default rule's outcome as explicit unbinding and edits are judged
// against known actions: capturing a key an inherited default holds is a
// conflict, never a silent unbind of the other action.
export function openDraft(state, catalog) {
  const config = copyConfig(state?.config ?? factoryKeybindings());
  return { ...config, profiles: config.profiles.map((profile) => settleProfile(catalog, profile)) };
}

// The bindings `actionId` resolves to in one profile and platform variant.
export function actionBindings(catalog, profile, platform, actionId) {
  return profileKeymap(catalog, profile, platform).bindingsFor(actionId);
}

// An edit target: one action in one profile's platform variant.
//   { profileId, platform, actionId }

function overrideFor(draft, { profileId, platform, actionId }) {
  const profile = draft.profiles.find((item) => item.id === profileId);
  return profile?.overrides?.[platform]?.find((o) => o.action === actionId) ?? null;
}

// Whether the action has its own binding list in that variant (Reset
// applies), rather than inheriting its factory default.
export function isCustomized(draft, target) {
  return overrideFor(draft, target) !== null;
}

function updateVariant(draft, { profileId, platform }, update) {
  return {
    ...draft,
    profiles: draft.profiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, overrides: { ...profile.overrides, [platform]: update(profile.overrides?.[platform] ?? []) } }
        : profile,
    ),
  };
}

function sameSet(a, b) {
  return a.length === b.length && a.every((binding) => b.includes(binding));
}

// Sets the complete binding list of the target action. Repeats are dropped.
// A list equal to the factory default becomes inheritance again, so only
// real customizations are stored.
function setBindings(catalog, draft, target, keys) {
  const unique = [...new Set(keys)];
  const defaults = catalog.get(target.actionId)?.defaults?.[target.platform];
  const inherit = defaults && sameSet(unique, defaults);
  return updateVariant(draft, target, (list) => {
    const rest = list.filter((o) => o.action !== target.actionId);
    if (inherit) return rest;
    const index = list.findIndex((o) => o.action === target.actionId);
    const next = { action: target.actionId, keys: unique };
    if (index === -1) return [...rest, next];
    return list.map((o, i) => (i === index ? next : o));
  });
}

function currentBindings(catalog, draft, target) {
  const profile = draft.profiles.find((item) => item.id === target.profileId);
  return actionBindings(catalog, profile, target.platform, target.actionId);
}

// Adds an alternative binding (a canonical binding from keys.js).
export function addBinding(catalog, draft, target, binding) {
  return setBindings(catalog, draft, target, [...currentBindings(catalog, draft, target), binding]);
}

// Replaces the alternative at `index` (a chip re-recorded).
export function replaceBinding(catalog, draft, target, index, binding) {
  const keys = currentBindings(catalog, draft, target).map((key, i) => (i === index ? binding : key));
  return setBindings(catalog, draft, target, keys);
}

// Removes the alternative at `index`. Removing the last one leaves the
// action intentionally unbound (an empty override).
export function removeBinding(catalog, draft, target, index) {
  const keys = currentBindings(catalog, draft, target).filter((_, i) => i !== index);
  return setBindings(catalog, draft, target, keys);
}

// Returns one action to its factory default in that variant only.
export function resetAction(draft, target) {
  return updateVariant(draft, target, (list) => list.filter((o) => o.action !== target.actionId));
}

// A comparable form of a config: override order is not meaningful.
function canonicalConfig(config) {
  return JSON.stringify({
    version: config.version,
    activeProfile: config.activeProfile,
    profiles: config.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      knownActions: [...(profile.knownActions ?? [])].sort(),
      overrides: Object.fromEntries(
        Object.keys(profile.overrides ?? {})
          .sort()
          .map((platform) => [
            platform,
            [...profile.overrides[platform]].sort((a, b) => a.action.localeCompare(b.action)),
          ]),
      ),
    })),
  });
}

// Whether the draft has unsaved edits relative to the draft as opened.
export function isDirty(draft, opened) {
  return canonicalConfig(draft) !== canonicalConfig(opened);
}

// What a keydown means while a binding is being recorded:
//   null                          keep waiting (modifier-only, IME
//                                 composition, auto-repeat)
//   { type: "cancel" }            Escape: drop the capture, change nothing
//   { type: "reserved", binding } Escape/Tab/Enter (with Shift at most) stay
//                                 dialog and focus keys and cannot be bound
//   { type: "binding", binding }  the canonical binding to record
export function captureKey(event) {
  if (event.repeat) return null;
  const binding = bindingFromEvent(event);
  if (!binding) return null;
  if (binding === "escape") return { type: "cancel" };
  if (isReservedBinding(binding)) return { type: "reserved", binding };
  return { type: "binding", binding };
}

// Persists the whole draft, and only after the write succeeded hands the
// returned state to `apply` (which updates live dispatch and the palette).
// `save` is SaveKeybindings(config, catalog); the backend validates the
// whole section and leaves disk and memory unchanged on any error. Returns
// { ok: true, state } or { ok: false, error } (the draft stays the caller's).
export async function saveDraft({ draft, catalog, save, apply }) {
  let state;
  try {
    state = await save(draft, catalogDescriptor(catalog));
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
  apply(state);
  return { ok: true, state };
}

const EXTENSION_NAVIGATION = "global.open-extension.";
const EXTENSIONS_GROUP = "global.extensions";

// The sidebar entry an action is listed under (see actionGroups).
function groupIdOf(action) {
  return action.id.startsWith(EXTENSION_NAVIGATION) ? EXTENSIONS_GROUP : action.context;
}

// Sidebar entries: one per menu context (its `page` and `state`), in catalog
// context order, except that opening extension pages, which lives in the
// global context, gets its own entry right after it. Contexts without
// actions are left out.
function actionGroups(catalog) {
  const groups = [];
  const add = (id, page, state, actions) => {
    if (actions.length) groups.push({ id, page, state, actions });
  };
  for (const context of catalog.contexts) {
    const actions = catalog.inContext(context.id);
    const page = context.page ?? context.label;
    const state = context.state ?? "";
    if (context.id === "global") {
      add("global", page, state, actions.filter((a) => !a.id.startsWith(EXTENSION_NAVIGATION)));
      add(EXTENSIONS_GROUP, "Extensions", "Open extension pages", actions.filter((a) => a.id.startsWith(EXTENSION_NAVIGATION)));
    } else {
      add(context.id, page, state, actions);
    }
  }
  return groups;
}

// Overrides for extension actions the catalog lacks are dormant: the
// extension (or that action of it) is missing. They stay in the profile,
// never run, and are listed as unavailable so the researcher sees the
// customization is kept. The ids follow catalog.js's extension id scheme;
// other unknown ids are kept but not listed (they are not extension data).
const EXTENSION_PAGE = /^(?:extension|extension-page)\.([a-z0-9-]+)\.([a-z0-9-.]+)$/;

function unavailableAction(catalog, actionId) {
  if (actionId.startsWith(EXTENSION_NAVIGATION)) {
    const extension = actionId.slice(EXTENSION_NAVIGATION.length);
    return {
      group: "global.extensions",
      note: "Extension unavailable",
      action: { id: actionId, context: "global", label: extension, description: `Open ${extension}` },
    };
  }
  const match = EXTENSION_PAGE.exec(actionId);
  if (!match) return null;
  const [, extension, slug] = match;
  const context = `extension-page.${extension}`;
  const installed = catalog.contexts.some((c) => c.id === context);
  return {
    group: context,
    extension,
    note: installed ? "Not offered by this extension" : "Extension unavailable",
    action: {
      id: actionId,
      context,
      label: slug === "toggle-settings" && actionId.startsWith("extension-page.") ? `Toggle ${extension} Settings` : slug,
      description: "",
    },
  };
}

// Rows for the variant's dormant extension overrides, by sidebar entry id.
// Their controls are disabled: Settings changes bindings of available
// actions only, and the override must survive untouched until the
// extension returns.
function unavailableRows(catalog, profile, platform) {
  const byGroup = new Map();
  for (const { action: actionId, keys } of profile.overrides?.[platform] ?? []) {
    if (catalog.has(actionId)) continue;
    const found = unavailableAction(catalog, actionId);
    if (!found) continue;
    const bindings = [...new Set((keys ?? []).map(normalizeBinding).filter(Boolean))];
    const rows = byGroup.get(found.group) ?? { extension: found.extension, rows: [] };
    rows.rows.push({
      action: found.action,
      bindings,
      display: bindings.map((binding) => formatBinding(binding, platform)),
      customized: true,
      available: false,
      status: "unavailable",
      note: found.note,
      problem: "",
    });
    byGroup.set(found.group, rows);
  }
  return byGroup;
}

function matches(row, group, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const { action, bindings, display } = row;
  const text = [action.label, action.description, action.keywords, group.page, group.state, row.note, ...bindings, ...display]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

// A menu context as the sidebar names it: "Ledger · Drawer closed".
function contextName(catalog, contextId) {
  const context = catalog.contexts.find((c) => c.id === contextId);
  if (!context) return contextId;
  const page = context.page ?? context.label ?? contextId;
  return context.state && context.id !== "global" ? `${page} · ${context.state}` : page;
}

// A validateProfile problem as [actionId, message] pairs, one per action
// involved and worded for that action's row. The first pair is the action
// the problem is located at.
function explain(catalog, problem) {
  const label = (id) => catalog.get(id)?.label ?? id;
  const where = (id) => contextName(catalog, catalog.get(id)?.context);
  // Another action, named with its context when that differs (overlapping
  // contexts are one collision domain but different sidebar entries).
  const other = (id, from) =>
    catalog.get(id)?.context === catalog.get(from)?.context ? label(id) : `${label(id)} in ${where(id)}`;
  const [first, ...rest] = problem.actions;
  const binding = problem.binding && formatBinding(problem.binding, problem.platform);
  switch (problem.kind) {
    case "menu-unbound":
      return [[first, "The Marasi menu must have a binding"]];
    case "reserved":
      return [[first, `${binding} is reserved for dialogs and focus`]];
    case "duplicate":
      return [
        [first, `${binding} is also bound to ${other(rest[0], first)}`],
        [rest[0], `${binding} is also bound to ${other(first, rest[0])}`],
      ];
    case "menu-shadowed":
      return [
        [first, `${binding} is shadowed by ${rest.map((id) => other(id, first)).join(", ")}; the menu must open everywhere`],
        ...rest.map((id) => [id, `${binding} would shadow ${label(first)}, which must open everywhere`]),
      ];
    default:
      return [[first, problem.message]];
  }
}

// The variant's explanations, per action and worded for the action's own
// row:
//   conflicts  validation problems (validateProfile) that block Save
//   shadows    allowed shadowing: an action outside the global context
//              shares a binding with a global action, so where its context
//              is eligible it wins and the global action does not run.
//              The global context is eligible everywhere, so this needs no
//              eligibility analysis. Shadowing the menu opening is a
//              conflict instead (menu-shadowed).
function rowProblems(catalog, profile, platform) {
  const label = (id) => catalog.get(id)?.label ?? id;
  const where = (id) => contextName(catalog, catalog.get(id)?.context);
  const key = (binding) => formatBinding(binding, platform);
  const conflicts = new Map();
  const shadows = new Map();
  const note = (messages, id, message) => {
    const list = messages.get(id) ?? [];
    if (!list.includes(message)) messages.set(id, [...list, message]);
  };
  for (const problem of validateProfile(catalog, profile)) {
    if (problem.platform !== platform) continue;
    for (const [id, message] of explain(catalog, problem)) note(conflicts, id, message);
  }
  const keymap = profileKeymap(catalog, profile, platform);
  for (const action of catalog.actions) {
    if (action.context === "global") continue;
    for (const binding of keymap.bindingsFor(action.id)) {
      for (const id of keymap.actionsFor(binding)) {
        const shadowed = catalog.get(id);
        if (shadowed.context !== "global" || id === OPEN_MENU) continue;
        if (contextsConflict(catalog.contexts, shadowed.context, action.context)) continue;
        note(shadows, action.id, `${key(binding)} shadows ${label(id)} (${where(id)}) here`);
        note(shadows, id, `${key(binding)} is shadowed by ${label(action.id)} in ${where(action.id)}`);
      }
    }
  }
  return { conflicts, shadows };
}

// The profile-level rules SaveKeybindings checks before any binding
// (checkKeybindingStructure in keybinding_validation.go): valid unique ids,
// unique nonempty names (trimmed, case-insensitive) and an active profile
// that exists. Bindings in a draft come from capture, so they are always
// canonical and never reserved here.
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function profileProblems(draft) {
  const problems = [];
  const at = (profile, message) => ({ profileId: profile?.id ?? null, platform: null, groupId: null, actionId: null, message });
  const ids = new Set();
  const names = new Set();
  for (const profile of draft.profiles) {
    if (!PROFILE_ID.test(profile.id)) problems.push(at(profile, `Profile id "${profile.id}" is invalid`));
    else if (ids.has(profile.id)) problems.push(at(profile, `Profile id "${profile.id}" is used twice`));
    ids.add(profile.id);
    const name = (profile.name ?? "").trim();
    if (!name) problems.push(at(profile, "A profile has no name"));
    else if (names.has(name.toLowerCase())) problems.push(at(profile, `Profile name "${name}" is used twice`));
    names.add(name.toLowerCase());
  }
  if (!draft.profiles.some((profile) => profile.id === draft.activeProfile)) {
    problems.push(at(null, "The active profile does not exist"));
  }
  return problems;
}

// Everything that blocks saving `draft`: every profile and both platform
// variants, not only the one on screen. Each problem says where it is, so
// one on a hidden profile or platform can still be found and shown:
//   { profileId, platform, groupId, actionId, message }
// `message` reads "Profile · Platform · Page · State · Action: explanation".
// Profile-level problems have null platform, groupId and actionId. With
// `current` ({ profileId, platform }) that variant's problems come first.
export function saveProblems(catalog, draft, current = {}) {
  const variant = draft.profiles.flatMap((profile) =>
    validateProfile(catalog, profile).map((problem) => {
      const [actionId, explanation] = explain(catalog, problem)[0];
      const action = catalog.get(actionId);
      const place = [profile.name, PLATFORM_NAMES[problem.platform], contextName(catalog, action.context), action.label];
      return {
        profileId: profile.id,
        platform: problem.platform,
        groupId: groupIdOf(action),
        actionId,
        message: `${place.join(" · ")}: ${explanation}`,
      };
    }),
  );
  const onScreen = (p) => p.profileId === current.profileId && p.platform === current.platform;
  return [...profileProblems(draft), ...variant.filter(onScreen), ...variant.filter((p) => !onScreen(p))];
}

const count = (rows, status) => rows.filter((row) => row.status === status).length;

// The modal's view of one profile's platform variant:
//   { groups: [group], unboundCount, conflictCount }
//   group = { id, page, state, all: [row], items: [row], unboundCount, conflictCount }
// `all` is every action of the entry (sidebar counts), `items` those
// matching `query` and `filter` ("all" | "unbound" | "conflict"). A row is
//   { action, bindings, display, customized, status, problem }
// with `display` the palette notation of each binding, `status` "conflict"
// (with `problem` explaining it), "unbound", "shadowing" (allowed, with
// `problem`), "unavailable" or "". An unavailable row (`available: false`,
// `note` saying why) is a dormant extension override: its status comes
// before any other, it is listed after its entry's available actions (or in
// an entry of its own for a missing extension page), and it is never counted
// or filtered as unbound or conflicting.
export function browse({ catalog, profile, platform, query = "", filter = "all" }) {
  const keymap = profileKeymap(catalog, profile, platform);
  const overridden = new Set((profile.overrides?.[platform] ?? []).map((o) => o.action));
  const { conflicts, shadows } = rowProblems(catalog, profile, platform);
  const unavailable = unavailableRows(catalog, profile, platform);
  const entries = actionGroups(catalog);
  for (const [id, { extension }] of unavailable) {
    if (entries.some((group) => group.id === id)) continue;
    if (id === "global.extensions") {
      const at = entries.findIndex((group) => group.id === "global") + 1;
      entries.splice(at, 0, { id, page: "Extensions", state: "Open extension pages", actions: [] });
    } else {
      entries.push({ id, page: extension, state: "Extension unavailable", actions: [] });
    }
  }
  const groups = entries.map((group) => {
    const all = group.actions.map((action) => {
      const bindings = keymap.bindingsFor(action.id);
      const conflict = conflicts.get(action.id);
      const shadow = shadows.get(action.id);
      let status = "";
      if (conflict) status = "conflict";
      else if (!bindings.length) status = "unbound";
      else if (shadow) status = "shadowing";
      return {
        action,
        bindings,
        display: bindings.map((binding) => formatBinding(binding, platform)),
        customized: overridden.has(action.id),
        available: true,
        status,
        problem: (conflict ?? shadow ?? []).join("; "),
      };
    });
    all.push(...(unavailable.get(group.id)?.rows ?? []));
    const items = all.filter(
      (row) => matches(row, group, query) && (filter === "all" || row.status === filter),
    );
    return {
      id: group.id,
      page: group.page,
      state: group.state,
      all,
      items,
      unboundCount: count(all, "unbound"),
      conflictCount: count(all, "conflict"),
    };
  });
  const total = (field) => groups.reduce((sum, group) => sum + group[field], 0);
  return { groups, unboundCount: total("unboundCount"), conflictCount: total("conflictCount") };
}
