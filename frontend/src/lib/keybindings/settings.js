import { slugify } from "./catalog.js";
import { isReservedBinding } from "./gate.js";
import { bindingFromEvent, formatBinding } from "./keys.js";
import {
  catalogDescriptor,
  factoryKeybindings,
  factoryProfile,
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

// A variant: one profile's platform bindings, { profileId, platform }.

// Whether any available action of the variant has its own binding list,
// so resetting the platform would change something.
export function isPlatformCustomized(catalog, draft, { profileId, platform }) {
  const profile = draft.profiles.find((item) => item.id === profileId);
  return (profile?.overrides?.[platform] ?? []).some((o) => catalog.has(o.action));
}

// Returns every action of the variant to its factory default. The other
// platform is untouched. Overrides of actions missing from the catalog
// (an extension that is not installed) are kept: they have no row to
// restore them from.
export function resetPlatform(catalog, draft, variant) {
  return updateVariant(draft, variant, (list) => list.filter((o) => !catalog.has(o.action)));
}

// Profile lifecycle. Profiles are created, duplicated, renamed, activated
// and deleted in the draft like any other edit; only Save persists them.
// A profile's id is its stable identity: it is chosen once, from the name
// at creation, and never changes when the profile is renamed.

// A profile id (lowercase letters, digits and single dashes, as the backend
// requires) derived from `name` and unused in the draft.
export function newProfileId(draft, name) {
  const base = slugify(name) || "profile";
  const taken = new Set(draft.profiles.map((p) => p.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// Why `name` cannot name a profile in the draft ("" when it can). Names
// are trimmed and compared case-insensitively, as the backend does.
// `exceptId` is the profile being renamed, which may keep its own name.
export function profileNameProblem(draft, name, exceptId) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return "Enter a profile name";
  const other = draft.profiles.find((p) => p.id !== exceptId && p.name.trim().toLowerCase() === wanted);
  return other ? `Another profile is already named ${other.name.trim()}` : "";
}

function checkName(draft, name, exceptId) {
  const problem = profileNameProblem(draft, name, exceptId);
  if (problem) throw new Error(problem);
  return name.trim();
}

function updateProfile(draft, profileId, update) {
  return { ...draft, profiles: draft.profiles.map((p) => (p.id === profileId ? update(p) : p)) };
}

// Renames a profile. Its id, and so its identity, stays the same.
export function renameProfile(draft, profileId, name) {
  const trimmed = checkName(draft, name, profileId);
  return updateProfile(draft, profileId, (p) => ({ ...p, name: trimmed }));
}

function addProfile(draft, profile) {
  return { ...draft, profiles: [...draft.profiles, profile] };
}

// `base`, or `base 2`, `base 3`, ... : the first that no profile uses.
export function suggestProfileName(draft, base) {
  let name = base;
  for (let n = 2; profileNameProblem(draft, name); n++) name = `${base} ${n}`;
  return name;
}

// Adds a profile with factory defaults, settled against the catalog like
// every profile in the draft. It is not activated.
export function createProfile(catalog, draft, name) {
  const trimmed = checkName(draft, name);
  return addProfile(draft, settleProfile(catalog, factoryProfile(newProfileId(draft, trimmed), trimmed)));
}

// Adds a copy of a profile under a new identity and name. The copy keeps
// both platform variants, every override (unbinding and dormant extension
// overrides included) and the known actions, so it resolves exactly like
// the source. It is not activated.
export function duplicateProfile(draft, sourceId, name) {
  const trimmed = checkName(draft, name);
  const source = draft.profiles.find((p) => p.id === sourceId);
  return addProfile(draft, { ...structuredClone(source), id: newProfileId(draft, trimmed), name: trimmed });
}

const profileName = (draft, profileId) => draft.profiles.find((p) => p.id === profileId)?.name ?? profileId;

// Why the profile cannot be made active ("" when it can).
export function makeActiveBlocker(draft, profileId) {
  return draft.activeProfile === profileId ? `${profileName(draft, profileId)} is already the active profile` : "";
}

// Chooses the profile dispatch uses once the draft is saved.
export function makeActive(draft, profileId) {
  return { ...draft, activeProfile: profileId };
}

// Why the profile cannot be deleted ("" when it can): the last profile
// stays, and the active one needs a replacement made active first.
export function deleteBlocker(draft, profileId) {
  if (draft.profiles.length <= 1) return "The last profile cannot be deleted";
  if (draft.activeProfile === profileId) {
    return `Make another profile active before deleting ${profileName(draft, profileId)}`;
  }
  return "";
}

export function deleteProfile(draft, profileId) {
  const blocker = deleteBlocker(draft, profileId);
  if (blocker) throw new Error(blocker);
  return { ...draft, profiles: draft.profiles.filter((p) => p.id !== profileId) };
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

function matches(row, group, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const { action, bindings, display } = row;
  const text = [action.label, action.description, action.keywords, group.page, group.state, ...bindings, ...display]
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
// (with `problem` explaining it), "unbound" or "".
export function browse({ catalog, profile, platform, query = "", filter = "all" }) {
  const keymap = profileKeymap(catalog, profile, platform);
  const overridden = new Set((profile.overrides?.[platform] ?? []).map((o) => o.action));
  const problems = rowProblems(catalog, profile, platform);
  const groups = actionGroups(catalog).map((group) => {
    const all = group.actions.map((action) => {
      const bindings = keymap.bindingsFor(action.id);
      const problem = problems.get(action.id) ?? "";
      return {
        action,
        bindings,
        display: bindings.map((binding) => formatBinding(binding, platform)),
        customized: overridden.has(action.id),
        status: problem ? "conflict" : bindings.length ? "" : "unbound",
        problem,
      };
    });
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
