# Connected services update and restart through the control API

Any running service the app is attached to — local or remote, on desktop or mobile — checks for updates, changes its channel, installs or reinstalls builds, and restarts through its own control API (`/update/*` and `/service/restart`; see `marasi docs/adr/2026-10-18-service-instances-install-updates.md` and `marasi docs/adr/2026-10-18-restart-hands-over-and-rolls-back.md`). All connection controls and service updates live in Connections; `Settings → Connection` is removed, and `Settings → Updates` stays desktop-only for Marasi App alone.

Previously the desktop app maintained a second updater in Go (`CheckForCLIUpdate` and `cli_channel` in app config) beside a passive service-update status line inside `Settings → Updates`. That mixed local-machine CLI settings with whichever remote or local service was active, split channel configuration between `marasi_appconfig.yaml` and `marasi_config.yaml`, and left mobile apps unable to update or restart a remote service.

The desktop Go CLI path remains only for work the control API cannot do: locating or choosing the local Marasi CLI path, first-time install when no CLI exists, extracting the app's carried CLI offline (see [The app carries a compressed CLI it installs once](2026-11-08-the-app-carries-a-compressed-cli-it-installs-once.md)), and recovering an unreachable or outdated local instance.

## Considered options

- **Keep Go's CLI updater for local connections and use the control API only for remotes.** Rejected because local and remote connections would still have different capabilities, channel settings (`cli_channel` vs `marasi_config.yaml`), and restart semantics (hard stop/start vs socket handover and rollback).
- **Keep a unified `Settings → Updates` hub with tabs for Marasi App and the active service.** Rejected because updating a service is tied to a specific connection (and its restart/stop lifecycle), and keeping service actions in Connections avoids splitting connection management across two screens.
