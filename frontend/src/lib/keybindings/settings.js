import { isReservedBinding } from "./gate.js";
import { bindingFromEvent, formatBinding, normalizeBinding } from "./keys.js";
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
      add("global.extensions", "Extensions", "Open extension pages", actions.filter((a) => a.id.startsWith(EXTENSION_NAVIGATION)));
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

// One explanation per action for the variant's validation problems
// (validateProfile), worded for the action's own row.
function rowProblems(catalog, profile, platform) {
  const label = (id) => catalog.get(id)?.label ?? id;
  const key = (binding) => formatBinding(binding, platform);
  const messages = new Map();
  const note = (id, message) => {
    if (!messages.has(id)) messages.set(id, message);
  };
  for (const problem of validateProfile(catalog, profile)) {
    if (problem.platform !== platform) continue;
    const [first, ...rest] = problem.actions;
    if (problem.kind === "menu-unbound") note(first, "The Marasi menu must have a binding");
    else if (problem.kind === "reserved") note(first, `${key(problem.binding)} is reserved for dialogs and focus`);
    else if (problem.kind === "duplicate") {
      note(first, `${key(problem.binding)} is also bound to ${label(rest[0])}`);
      note(rest[0], `${key(problem.binding)} is also bound to ${label(first)}`);
    } else if (problem.kind === "menu-shadowed") {
      note(first, `${key(problem.binding)} is shadowed by ${rest.map(label).join(", ")}`);
      for (const id of rest) note(id, `${key(problem.binding)} shadows ${label(first)}`);
    }
  }
  return messages;
}

const count = (rows, status) => rows.filter((row) => row.status === status).length;

// The modal's view of one profile's platform variant:
//   { groups: [group], unboundCount, conflictCount }
//   group = { id, page, state, all: [row], items: [row], unboundCount, conflictCount }
// `all` is every action of the entry (sidebar counts), `items` those
// matching `query` and `filter` ("all" | "unbound" | "conflict"). A row is
//   { action, bindings, display, customized, status, problem }
// with `display` the palette notation of each binding, `status` "conflict"
// (with `problem` explaining it), "unbound", "unavailable" or "". An
// unavailable row (`available: false`, `note` saying why) is a dormant
// extension override: listed after its entry's available actions, or in an
// entry of its own for a missing extension page, and never counted as
// unbound.
export function browse({ catalog, profile, platform, query = "", filter = "all" }) {
  const keymap = profileKeymap(catalog, profile, platform);
  const overridden = new Set((profile.overrides?.[platform] ?? []).map((o) => o.action));
  const problems = rowProblems(catalog, profile, platform);
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
      const problem = problems.get(action.id) ?? "";
      return {
        action,
        bindings,
        display: bindings.map((binding) => formatBinding(binding, platform)),
        customized: overridden.has(action.id),
        available: true,
        status: problem ? "conflict" : bindings.length ? "" : "unbound",
        problem,
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
