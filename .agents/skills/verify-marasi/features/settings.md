# Application settings

## Sub-features

- Vim, syntax mode, default interface, and default port
- Waypoint management
- Chrome executable paths and profiles
- Build version displayed below the page heading (`dev` in a local development build)

## How to get to it (user POV)

Select the rail item titled `Settings`, or press `Command+S` after the dashboard has mounted once. The page exposes `Marasi Settings`, the build version, Waypoints, Chrome Paths, and Chrome Profiles.

## Driving it with Chrome CDP

Run `scripts/drive.sh settings` for route proof. For persistence, toggle Vim and confirm `vim_enabled` changed in the isolated `marasi_appconfig.yaml`, then toggle it back and prove the original value was restored:

```json
{"name":"vim-off","steps":[{"click":"[data-testid=\"slide-toggle\"]"},{"waitSelector":"[role=switch][aria-checked=false]"}]}
```

`{"text":"Vim Enabled"}` clicks the same control. The checkbox inside is `display:none`; read state from `[role=switch]`'s `aria-checked`.

## Gotchas

- General settings persist to `marasi_appconfig.yaml`, Chrome settings to `marasi_config.yaml`, and waypoints to the project database.
- Address and port edits do not visibly restart the current listener.
- Chrome Profiles can sit below the fold at `1600x900`, depending on how many rows exist; the driver scrolls a unique match into view.
- Default Interface and Default Port persist on `change` (blur or Enter), not per keystroke. Both inputs share `placeholder="Listener"`, so scope by the section.
- Clicking the `Syntax Mode:` caption activates its first nested radio and writes `syntax_mode=disabled`. Click the radio you mean.
- Row X and pencil buttons have no labels; find the `<tr>` with `hasText` first.
- Adding a Chrome profile only appends YAML. Deleting a profile also removes `$configDir/chrome_profiles/<name>`. Directories appear later when Chrome starts.
