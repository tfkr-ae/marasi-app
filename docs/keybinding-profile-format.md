# Keybinding profile file format

A keybinding profile file holds one Marasi keybinding profile, so it can be shared between machines and users. Settings → Keybindings → **Manage** → **Export** writes one, and **Import** reads one. This page describes format version 1.

The file is UTF-8 JSON. The suggested name is `<profile-name-slug>.marasi-keys.json`, but Marasi does not check the file name.

## Example

```json
{
  "format": "marasi-keybinding-profile",
  "version": 1,
  "profile": {
    "name": "Work",
    "overrides": {
      "macos": [
        { "action": "global.go-home", "keys": ["meta+1", "meta+h"] },
        { "action": "global.toggle-vim", "keys": [] },
        { "action": "extension.gone.do-thing", "keys": ["meta+alt+9"] }
      ],
      "windows-linux": [
        { "action": "global.go-ledger", "keys": ["ctrl+j"] }
      ]
    },
    "knownActions": ["global.go-home", "global.go-ledger", "global.open-menu", "global.toggle-vim"],
    "letters": [
      { "group": "global.go", "letter": "X" }
    ]
  }
}
```

## Fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | string | yes | Always `marasi-keybinding-profile`. |
| `version` | integer | yes | Format version. This page describes `1`. |
| `profile.name` | string | yes | Profile name. It must not be empty after trimming. |
| `profile.overrides` | object | no | Overrides per platform variant. The only keys are `macos` and `windows-linux`. A missing key means no overrides for that platform. |
| `profile.overrides.<platform>[].action` | string | yes | Menu action id, for example `global.go-ledger`. Lowercase letters, digits and dashes in two or more dot-separated parts. |
| `profile.overrides.<platform>[].keys` | array of strings | yes | The action's complete binding list on that platform. `[]` means the action is intentionally unbound. |
| `profile.knownActions` | array of strings | no | The action ids the profile was last saved against. See [New actions](#new-actions). A missing list means `[]`. |
| `profile.letters` | array | no | Menu letter overrides, the same on both platforms. See [Menu letters](#menu-letters). A missing list means `[]`. Export leaves it out when the profile uses the factory letters. |
| `profile.letters[].group` | string | yes | Menu group id: the group's menu context and its id, for example `global.go` or `ledger.drawer-open.copy`. The same pattern as an action id. Each group appears once. |
| `profile.letters[].letter` | string | yes | The group's menu letter: one capital letter `A` to `Z`, but not `K`, `Q` or `H`. |

No other fields are allowed at any level.

The profile has no id. An id is local to one app config, so an imported profile always gets a new id.

## Semantics

These are the profile semantics of [Keybinding profiles override recoverable factory defaults](adr/2026-10-10-keybinding-profiles-override-factory-defaults.md):

- An action without an override inherits its factory default for that platform.
- An override replaces the default completely. An override with `keys: []` unbinds the action.
- An override for an action that this Marasi build does not have, such as one from an extension that is not installed, is kept and never runs. It becomes active again when the action exists.

### Menu letters

In the Marasi menu, ⌘ (Ctrl on Windows and Linux) and a menu group's menu letter open that group. A group without an override in `letters` keeps its factory letter, so the factory letters are always recoverable. An override for a group that this Marasi build does not have is kept and has no effect.

A menu letter is one capital letter `A` to `Z`. `K`, `Q` and `H` are never menu letters, on any platform: ⌘K opens and closes the menu, and ⌘Q and ⌘H quit and hide Marasi on macOS. Two menu groups at one menu level cannot share a letter. A level is the global groups, or one page context's groups together with those of the contexts that share its menu (the Launchpad tree's beside the Launchpad's) and the global groups, because every menu lists the global groups.

### Bindings

A binding is one key with zero or more modifiers, joined by `+`. Modifiers are `meta`, `ctrl`, `alt` and `shift`, in that order. The key is one character, in lowercase for letters, or one of `enter`, `escape`, `tab`, `space`, `plus`, `backspace`, `delete`, `insert`, `home`, `end`, `pageup`, `pagedown`, `arrowup`, `arrowdown`, `arrowleft`, `arrowright` and `f1` to `f24`. Export writes this canonical form.

Import also accepts the notation of the Marasi menu (`⌘+⇧+F`, `cmd+shift+f`, `ctrl+⇧+enter`) and converts it to the canonical form. Escape, Tab and Enter, alone or with Shift only, are reserved for dialogs and focus and cannot be bound.

### New actions

`knownActions` decides how the profile treats actions that were added to Marasi after the profile was last saved. An action that is not in `knownActions` and has no override inherits its factory default, unless that default collides with one of the profile's customizations. In that case the action is unbound and the customization wins. Marasi records the outcome when it imports the profile.

## Import rules

Marasi reads and checks the whole file before it changes anything. It rejects the file, and changes no profile, when:

- the file is not valid JSON, or `format` is not `marasi-keybinding-profile`;
- `version` is greater than 1 (the file is from a newer Marasi), or it is not the integer 1;
- a field is missing, has the wrong type, or is unknown;
- an action id is invalid or appears twice in one platform;
- a binding cannot be read or is reserved;
- on either platform, the menu opening (`global.open-menu`) has no binding or another action shadows it;
- on either platform, two actions that can be active at the same time share a binding;
- a menu group id is invalid or appears twice, a menu letter is not one capital letter `A` to `Z` or is `K`, `Q` or `H`, or two menu groups at one menu level share a letter. The message names both groups, as Settings does when it refuses to save.

Overrides for missing actions are not errors.

An accepted profile is added as a new profile. If its name is already used (compared trimmed and case-insensitively), Marasi adds a number: `Work 2`, `Work 3`. No existing profile is replaced. The imported profile is not made active, and it is kept only when you select **Save**.

Export writes the selected profile as the Keybindings window shows it, including unsaved edits. Export is not available while the profile has a conflict, because Marasi would reject the file on import.

## Versions

| Version | Change |
| --- | --- |
| 1 | First version. `profile.letters` was added later without a version change: export writes it only when the profile has menu letter overrides, so other files still read in a Marasi without it. |

A change that older versions cannot read safely must increase `version`. Marasi rejects files with a version greater than the one it reads.

## Implementation

- `frontend/src/lib/keybindings/portable.js` writes, parses and validates the format. Tests are in `portable.test.js`.
- `keybinding_files.go` shows the native save and open dialogs and reads and writes the file text (`ExportKeybindingProfile`, `ImportKeybindingProfile`). It refuses files larger than 1 MiB.
- When the environment variable `MARASI_KEYBINDINGS_PROFILE_FILE` is set, both methods use that path instead of showing a dialog. Tests and headless verification use it, because they cannot operate native dialogs.
