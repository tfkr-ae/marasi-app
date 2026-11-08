---
status: superseded by 2026-11-08-the-app-carries-a-compressed-cli-it-installs-once
---

# The Marasi CLI is never bundled with the app

The app does not ship a `marasi` binary. It uses the one on PATH, or one at a path the researcher sets in app config; when there is none it offers to install the CLI's GitHub release for the app's channel, verifying `checksums.txt.minisig` against a key built into the app and failing closed. CLI updates are a separate section of Settings from app updates. Keeping them apart lets the CLI the researcher uses in a terminal and the one the app runs be the same program, updated once, and lets the app and Marasi release on their own schedules.

We considered embedding the binary in the app bundle: one download, versions always matched. We rejected it because a bundled copy would sit beside a second CLI on PATH, two Marasi versions would then compete for the same instances and config directory, and every Marasi fix would wait for an app release. The cost is a first-run step when no CLI is found, and version skew, which the app reports as a warning rather than refusing to connect.

Until Marasi reports an API level in `/service/status`, the Marasi version the app pins in `go.mod` (still needed for Chrome) is the oldest service it supports: bumping the pin raises it, and nobody keeps a separate list. Once the API level exists, the app keeps a supported range of levels, updated in the change that adopts a new level, and installs the newest CLI on its channel inside that range.
