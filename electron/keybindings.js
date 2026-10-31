// The `keybindings` section of the app config (v1 keybindings.go and the
// catalog-free half of keybinding_validation.go). The renderer checks
// profiles against the action catalog before it saves; this module reads
// the section, refuses one that breaks its structure, and converts between
// the file's snake_case keys and the frontend's camelCase. See
// docs/adr/2026-10-10-keybinding-profiles-override-factory-defaults.md.

export const keybindingsKey = "keybindings";
const keybindingsVersion = 1;
const platforms = ["macos", "windows-linux"];

const actionIDPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const profileIDPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function factoryKeybindings() {
  return {
    version: keybindingsVersion,
    activeProfile: "default",
    profiles: [
      { id: "default", name: "Default", overrides: { macos: [], "windows-linux": [] }, knownActions: [] },
    ],
  };
}

// Canonical binding text, mirroring normalizeBinding in the frontend's
// keys.js: modifiers in the order meta, ctrl, alt, shift, then the key.
const modifierOrder = ["meta", "ctrl", "alt", "shift"];
const modifierAliases = {
  meta: "meta", cmd: "meta", command: "meta", "⌘": "meta",
  ctrl: "ctrl", control: "ctrl", "⌃": "ctrl",
  alt: "alt", option: "alt", "⌥": "alt",
  shift: "shift", "⇧": "shift",
};
const keyAliases = {
  "↩": "enter", return: "enter", esc: "escape",
  up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright",
  " ": "space", "+": "plus",
};
const namedKeys = new Set([
  "enter", "escape", "tab", "space", "plus", "backspace", "delete", "insert",
  "home", "end", "pageup", "pagedown", "arrowup", "arrowdown", "arrowleft", "arrowright",
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

function canonicalKey(token) {
  const lower = token.toLowerCase();
  if (Object.hasOwn(keyAliases, token)) return keyAliases[token];
  if (Object.hasOwn(keyAliases, lower)) return keyAliases[lower];
  if ([...token].length === 1) return lower;
  return namedKeys.has(lower) ? lower : "";
}

function canonicalBinding(text) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const tokens = trimmed.endsWith("++")
    ? [...trimmed.slice(0, -2).split("+"), "+"]
    : trimmed === "+"
      ? ["+"]
      : trimmed.split("+");
  const keyToken = tokens.pop().trim();
  const held = new Set();
  for (const token of tokens) {
    const modifier = modifierAliases[token.trim().toLowerCase()];
    if (!Object.hasOwn(modifierAliases, token.trim().toLowerCase())) return "";
    held.add(modifier);
  }
  if (!keyToken || Object.hasOwn(modifierAliases, keyToken.toLowerCase())) return "";
  const key = canonicalKey(keyToken);
  if (!key) return "";
  return [...modifierOrder.filter((m) => held.has(m)), key].join("+");
}

// Escape, Tab and Enter with no modifier other than Shift belong to dialogs
// and focus traversal (gate.js isReservedBinding).
function isReservedBinding(binding) {
  return ["escape", "tab", "enter"].includes(binding.replace(/^shift\+/, ""));
}

// Shape checks, as v1's strict YAML decode made them: unknown fields and
// wrong types are errors rather than silently dropped data.
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkFields(value, fields, where) {
  if (!isObject(value)) throw new Error(`invalid keybindings section: ${where} is not a mapping`);
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new Error(`invalid keybindings section: field ${key} not found in ${where}`);
  }
}

function checkType(value, check, what, where) {
  if (value !== undefined && value !== null && !check(value)) {
    throw new Error(`invalid keybindings section: ${where} ${what}`);
  }
}

const isString = (value) => typeof value === "string";
const isStringList = (value) => Array.isArray(value) && value.every(isString);

// The section as the frontend reads it, from the file's shape. Throws the
// problem when the section is unusable.
function fromSection(section) {
  if (section === undefined) throw new Error("keybindings section is missing");
  // A future format may add fields this version doesn't know, which is
  // "unsupported", not "invalid".
  if (isObject(section) && Number.isInteger(section.version) && section.version > keybindingsVersion) {
    throw unsupportedVersion(section.version);
  }
  checkFields(section, ["version", "active_profile", "profiles"], "keybindings");
  checkType(section.version, Number.isInteger, "version is not a number", "keybindings");
  checkType(section.active_profile, isString, "active_profile is not text", "keybindings");
  checkType(section.profiles, Array.isArray, "profiles is not a list", "keybindings");
  return {
    version: section.version ?? 0,
    activeProfile: section.active_profile ?? "",
    profiles: (section.profiles ?? []).map((profile, i) => {
      const where = `profile ${i + 1}`;
      checkFields(profile, ["id", "name", "overrides", "known_actions"], where);
      checkType(profile.id, isString, "id is not text", where);
      checkType(profile.name, isString, "name is not text", where);
      checkType(profile.overrides, isObject, "overrides is not a mapping", where);
      checkType(profile.known_actions, isStringList, "known_actions is not a list of text", where);
      const overrides = {};
      for (const [platform, list] of Object.entries(profile.overrides ?? {})) {
        checkType(list, Array.isArray, `overrides.${platform} is not a list`, where);
        overrides[platform] = (list ?? []).map((override) => {
          checkFields(override, ["action", "keys"], `${where} override`);
          checkType(override.action, isString, "action is not text", where);
          checkType(override.keys, isStringList, "keys is not a list of text", where);
          return { action: override.action ?? "", keys: override.keys ?? null };
        });
      }
      return { id: profile.id ?? "", name: profile.name ?? "", overrides, knownActions: profile.known_actions ?? [] };
    }),
  };
}

function unsupportedVersion(version) {
  return new Error(`keybindings version ${version} is not supported (this Marasi reads version ${keybindingsVersion})`);
}

// v1's checkKeybindingStructure: the rules that need no catalog.
function checkStructure(config) {
  if (config.version !== keybindingsVersion) {
    if (config.version > keybindingsVersion) throw unsupportedVersion(config.version);
    throw new Error(`keybindings version ${config.version} is invalid`);
  }
  if (!Array.isArray(config.profiles) || config.profiles.length === 0) throw new Error("keybindings have no profiles");
  const ids = new Set();
  const names = new Set();
  for (const profile of config.profiles) {
    if (!isString(profile.id) || !profileIDPattern.test(profile.id)) throw new Error(`profile id "${profile.id}" is invalid`);
    if (ids.has(profile.id)) throw new Error(`profile id "${profile.id}" is used twice`);
    ids.add(profile.id);
    const name = String(profile.name ?? "").trim().toLowerCase();
    if (!name) throw new Error(`profile "${profile.id}" has no name`);
    if (names.has(name)) throw new Error(`profile name "${String(profile.name).trim()}" is used twice`);
    names.add(name);
    if (!isStringList(profile.knownActions ?? [])) throw new Error(`profile "${profile.name}" has invalid known actions`);
    for (const [platform, overrides] of Object.entries(profile.overrides ?? {})) {
      if (!platforms.includes(platform)) throw new Error(`profile "${profile.name}" has unknown platform "${platform}"`);
      const actions = new Set();
      for (const override of overrides ?? []) {
        const where = `profile "${profile.name}" (${platform}) action "${override?.action}"`;
        if (!isString(override?.action) || !actionIDPattern.test(override.action)) throw new Error(`${where}: invalid action id`);
        if (actions.has(override.action)) throw new Error(`${where}: overridden twice`);
        actions.add(override.action);
        if (!Array.isArray(override.keys)) throw new Error(`${where}: missing keys (use [] to unbind)`);
        for (const key of override.keys) {
          const binding = isString(key) ? canonicalBinding(key) : "";
          if (!binding) throw new Error(`${where}: "${key}" is not a binding`);
          if (isReservedBinding(binding)) throw new Error(`${where}: "${key}" is reserved for dialogs and focus`);
        }
      }
    }
  }
  if (!ids.has(config.activeProfile)) throw new Error(`active profile "${config.activeProfile}" does not exist`);
}

/**
 * The saved section as { config, problem }, as v1's GetKeybindings returned
 * it: when the section can't be used, config is the factory profile and the
 * section stays on disk untouched.
 */
export function readKeybindings(section) {
  try {
    const config = fromSection(section);
    checkStructure(config);
    return { config, problem: "" };
  } catch (error) {
    return { config: factoryKeybindings(), problem: error.message };
  }
}

/** Checks `config` (frontend shape) and returns it in the file's shape. */
export function toConfigKeybindings(config) {
  checkStructure(config);
  return {
    version: config.version,
    active_profile: config.activeProfile,
    profiles: config.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      overrides: Object.fromEntries(
        Object.entries(profile.overrides ?? {}).map(([platform, list]) => [
          platform,
          list.map(({ action, keys }) => ({ action, keys: [...keys] })),
        ]),
      ),
      known_actions: [...(profile.knownActions ?? [])],
    })),
  };
}
