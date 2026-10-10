# Application settings

## Sub-features

- Vim, syntax mode, default interface, and default port
- Waypoint management
- Chrome executable paths and profiles
- Build version displayed below the page heading (`dev` in a local development build)
- Keybindings modal (`Configure Keybindings`): rebind menu actions per profile and platform, saved to the `keybindings` section of `marasi_appconfig.yaml`

## How to get to it (user POV)

Select the rail item titled `Settings`, or press `Command+S` from any route. The page exposes `Marasi Settings`, the build version, Waypoints, Chrome Paths, and Chrome Profiles.

## Driving it with Chrome CDP

Run `scripts/drive.sh settings` for route proof. For persistence, toggle Vim and confirm `vim_enabled` changed in the isolated `marasi_appconfig.yaml`, then toggle it back and prove the original value was restored:

```json
{"name":"vim-off","steps":[{"click":"[data-testid=\"slide-toggle\"]"},{"waitSelector":"[role=switch][aria-checked=false]"}]}
```

`{"text":"Vim Enabled"}` clicks the same control.

Keybindings: `{"text":"Configure Keybindings"}` opens the modal (`[data-keybindings-modal]`). Row controls have labels: `button[aria-label="Add binding to Ledger"]`, `button[aria-label="Remove ⌘+J from Ledger"]`, `button[aria-label="Reset Ledger"]`. Adding or re-recording a chip opens `[data-key-capture]`; send the combination with a `key` step. Escape cancels only the capture. Save closes the modal with a `Keybindings saved` toast; a failed save shows `[data-save-error]` and keeps the draft. Prove the result with the shortcut itself and the isolated YAML, then close with Cancel and `Discard` (or Escape when nothing changed) so doctor sees no residue:

```json
{"name":"kb-save","steps":[{"text":"Configure Keybindings"},{"waitText":"Every page"},{"click":"button[aria-label=\"Add binding to Ledger\"]"},{"waitSelector":"[data-key-capture]"},{"key":"cmd+j"},{"waitText":"Unsaved changes"},{"text":"Save"},{"waitText":"Keybindings saved"},{"key":"cmd+j"},{"waitPath":"/ledger"}]}
``` The checkbox inside is `display:none`; read state from `[role=switch]`'s `aria-checked`.

## Gotchas

- General settings persist to `marasi_appconfig.yaml`, Chrome settings to `marasi_config.yaml`, and waypoints to the project database.
- Address and port edits do not visibly restart the current listener.
- Chrome Profiles can sit below the fold at `1600x900`, depending on how many rows exist; the driver scrolls a unique match into view.
- Default Interface and Default Port persist on `change` (blur or Enter), not per keystroke. Both inputs share `placeholder="Listener"`, so scope by the section.
- Clicking the `Syntax Mode:` caption activates its first nested radio and writes `syntax_mode=disabled`. Click the radio you mean.
- Row X and pencil buttons have no labels; find the `<tr>` with `hasText` first.
- Adding a Chrome profile only appends YAML. Deleting a profile also removes `$configDir/chrome_profiles/<name>`. Directories appear later when Chrome starts.
- Keybinding conflicts show on the row (`… is also bound to …`) and block Save: `[data-save-blocked]` in the footer names the first problem as `Profile · Platform · Page · State · Action: …`, including problems on a profile or platform not on screen, and its `Show` button switches to it. Pick the platform with `{"click":"select","hasText":"This device"}` then `{"key":"w"}` or `{"key":"m"}`; `nth` within the modal picked the profile select.
- The keybindings modal takes Escape and backdrop clicks over: they cancel a capture, dismiss an in-modal card, or ask `Discard changes?` before closing with unsaved edits. To simulate a failed save, make the isolated config directory unwritable (`chmod a-w`), and restore it before cleanup.
- Keybinding profiles: `{"text":"Manage"}` opens `[data-profile-menu]`; pick entries with `{"text":"Duplicate","within":"[data-profile-menu]"}`. Disabled entries keep their reason in `title` (for example `button[role=menuitem][disabled][title="The last profile cannot be deleted"]`). New Profile, Duplicate and Rename open `[data-profile-name]` with the name selected: `cmd+a`, `insert`, then `enter`. Delete and the platform Reset confirm in `[role=alertdialog]`. Switch the platform with `{"click":"[data-keybindings-modal] label.label select"}` then `{"key":"w"}` or `{"key":"m"}`. Windows / Linux chips read `ctrl+⇧+J`, so aria-labels are `Remove ctrl+⇧+J from Ledger`.
- Ledger's palette lists only Ledger page actions; check global bindings such as Ledger's `⌘+J` in the menu on Settings or Home.
