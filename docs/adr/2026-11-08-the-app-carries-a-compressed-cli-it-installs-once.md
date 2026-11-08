---
status: accepted, supersedes 2026-11-06-the-marasi-cli-is-never-bundled
---

# The app carries a compressed CLI it installs once

Some corporate networks block bare executables downloaded from GitHub. There, the app's first-run Install of the Marasi CLI fails, and a researcher can't start a local instance at all. So release and nightly builds now carry their own platform's CLI, gzipped (about 18 MB on a 70 MB app), which CI fetches from the CLI release on the app's channel and verifies against the release signing key when it builds the app. When the app finds no CLI, Install extracts that copy into the install folder at once, without the network, and then runs the usual CLI update check. Development builds carry none.

The 2026-11-06 ADR rejected bundling for two reasons. Neither applies to this design:

- **Two CLIs competing for the same instances and config directory.** The app never runs the carried copy from inside the app. It is only a source for Install, so there is still exactly one installed CLI.
- **Every Marasi fix waiting for an app release.** CLI updates still download from the CLI's own release channel, independent of app releases. The carried copy is only the starting version, which the update check replaces.

Marasi releases also publish the CLI as archives, which such networks let through, so CLI updates work there too.

## Considered options

- **Download archives only, carry nothing.** This fixes updates, but the first install still depends on the network and on Marasi publishing archives.
- **xz or zstd instead of gzip.** These save 2–3 MB but add a dependency; gzip is in Go's standard library.
