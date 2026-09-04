# Application settings

## Sub-features

- Vim, syntax mode, default interface, and default port
- Waypoint management
- Chrome executable paths and profiles

## How to get to it (user POV)

Select the rail item titled `Settings`. The page exposes `Marasi Settings`, Waypoints, Chrome Paths, and Chrome Profiles.

## Driving it with Chrome CDP

Run `scripts/drive.sh settings` for route proof. For persistence, toggle Vim mode and confirm `vim_enabled` changed in the isolated `marasi_appconfig.yaml`, then toggle it back and prove the original value was restored.

## Gotchas

- General settings persist to `marasi_appconfig.yaml`, Chrome settings to `marasi_config.yaml`, and waypoints to the project database.
- Address and port edits do not visibly restart the current listener.
- Chrome Profiles is below the fold at the `1600x900` verification viewport.
- Profile creation and deletion also modify directories in the isolated home.
