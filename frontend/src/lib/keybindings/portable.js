import { slugify } from "./catalog.js";
import { isReservedBinding } from "./gate.js";
import { normalizeBinding } from "./keys.js";
import { PLATFORM_NAMES, PLATFORMS } from "./platform.js";
import { settleProfile, validateProfile } from "./profiles.js";
import { newProfileId, suggestProfileName } from "./settings.js";

// Portable keybinding profile files: one profile, both platform variants,
// independent of the app config it came from. The format is documented in
// docs/keybinding-profile-format.md; keep the two in step.
//
//   { "format": "marasi-keybinding-profile", "version": 1,
//     "profile": { "name", "overrides": { macos: [o], "windows-linux": [o] }, "knownActions": [id] } }
//
// The profile part is the app config's profile (profiles.js) without its id:
// an id is local to the config it lives in, so an import always gets a new
// identity.

export const PROFILE_FILE_FORMAT = "marasi-keybinding-profile";
export const PROFILE_FILE_VERSION = 1;

// Same patterns as actionIDPattern in keybinding_validation.go and the
// catalog's id check.
const ACTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

// The file text for one profile.
export function exportProfile(profile) {
  const file = {
    format: PROFILE_FILE_FORMAT,
    version: PROFILE_FILE_VERSION,
    profile: {
      name: profile.name.trim(),
      overrides: Object.fromEntries(
        PLATFORMS.map((platform) => [
          platform,
          (profile.overrides?.[platform] ?? []).map(({ action, keys }) => ({ action, keys: [...keys] })),
        ]),
      ),
      knownActions: [...(profile.knownActions ?? [])].sort(),
    },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// A file name to suggest when saving the export.
export function exportFileName(profile) {
  return `${slugify(profile.name) || "profile"}.marasi-keys.json`;
}

// Why the profile cannot be exported ("" when it can): a file with a
// conflict or a stranded menu would be rejected on import.
export function exportBlocker(catalog, draft, profileId) {
  const profile = draft.profiles.find((p) => p.id === profileId);
  if (!profile?.name.trim()) return "Name this profile before exporting it";
  return validateProfile(catalog, profile).length ? `Fix the conflicts in ${profile.name.trim()} before exporting it` : "";
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const show = (value) => JSON.stringify(value) ?? String(value);

function onlyFields(object, allowed, where) {
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new Error(`${where} has an unknown field ${show(unknown)}`);
}

// One platform variant's overrides, checked like checkKeybindingStructure
// in Go and with bindings in canonical form.
function readVariant(list, platform) {
  const name = PLATFORM_NAMES[platform];
  if (!Array.isArray(list)) throw new Error(`The ${name} bindings are not a list`);
  const seen = new Set();
  return list.map((override) => {
    if (!isObject(override)) throw new Error(`A ${name} binding is not an object`);
    onlyFields(override, ["action", "keys"], `A ${name} binding`);
    const where = `${name} action ${show(override.action)}`;
    if (typeof override.action !== "string" || !ACTION_ID.test(override.action)) throw new Error(`${where}: invalid action id`);
    if (seen.has(override.action)) throw new Error(`${where}: overridden twice`);
    seen.add(override.action);
    if (override.keys === undefined) throw new Error(`${where}: missing keys (use [] to unbind)`);
    if (!Array.isArray(override.keys)) throw new Error(`${where}: keys are not a list`);
    const keys = override.keys.map((key) => {
      const binding = normalizeBinding(key);
      if (!binding) throw new Error(`${where}: ${show(key)} is not a binding`);
      if (isReservedBinding(binding)) throw new Error(`${where}: ${show(key)} is reserved for dialogs and focus`);
      return binding;
    });
    return { action: override.action, keys: [...new Set(keys)] };
  });
}

// Parses and checks a profile file without a catalog: format, version and
// structure. Returns { name, overrides, knownActions } or throws.
function readProfileFile(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON");
  }
  if (!isObject(file) || file.format !== PROFILE_FILE_FORMAT) throw new Error("The file is not a Marasi keybinding profile");
  // The version comes before any other check: a newer format may add
  // fields this version does not know, which is "unsupported", not invalid.
  const { version } = file;
  if (Number.isInteger(version) && version > PROFILE_FILE_VERSION) {
    throw new Error(`Format version ${version} is not supported (this Marasi reads version ${PROFILE_FILE_VERSION}); the file is from a newer Marasi`);
  }
  if (version !== PROFILE_FILE_VERSION) throw new Error(`Format version ${show(version)} is invalid`);
  onlyFields(file, ["format", "version", "profile"], "The file");
  const { profile } = file;
  if (!isObject(profile)) throw new Error("The file has no profile");
  onlyFields(profile, ["name", "overrides", "knownActions"], "The profile");
  if (typeof profile.name !== "string" || !profile.name.trim()) throw new Error("The profile has no name");
  const overrides = profile.overrides ?? {};
  if (!isObject(overrides)) throw new Error("The profile's bindings are not an object");
  const unknown = Object.keys(overrides).find((platform) => !PLATFORMS.includes(platform));
  if (unknown !== undefined) throw new Error(`The profile has an unknown platform ${show(unknown)}`);
  const knownActions = profile.knownActions ?? [];
  if (!Array.isArray(knownActions) || knownActions.some((id) => typeof id !== "string" || !ACTION_ID.test(id))) {
    throw new Error("The profile's known actions are not a list of action ids");
  }
  return {
    name: profile.name.trim(),
    overrides: Object.fromEntries(PLATFORMS.map((platform) => [platform, readVariant(overrides[platform] ?? [], platform)])),
    knownActions: [...new Set(knownActions)],
  };
}

// Adds the profile in `text` to the draft as a new profile: a new id, its
// name made unique ("Work 2" when "Work" is taken), never active, settled
// against `catalog` like every draft profile. The file is fully parsed and
// validated first; on any problem this throws and the draft is untouched.
// Overrides for actions this build lacks (extensions not installed) are
// kept dormant. Returns { draft, profileId, name }.
export function importProfile(catalog, draft, text) {
  const file = readProfileFile(text);
  const name = suggestProfileName(draft, file.name);
  const candidate = { id: newProfileId(draft, name), name, overrides: file.overrides, knownActions: file.knownActions };
  const [problem] = validateProfile(catalog, candidate);
  if (problem) {
    const prefix = `${candidate.name} (${problem.platform}): `;
    throw new Error(`${PLATFORM_NAMES[problem.platform]}: ${problem.message.slice(prefix.length)}`);
  }
  const imported = settleProfile(catalog, candidate);
  return { draft: { ...draft, profiles: [...draft.profiles, imported] }, profileId: imported.id, name };
}
