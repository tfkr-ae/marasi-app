# CLI archive fixtures

These archives come from Marasi's `scripts/archive-cli.sh` at `be1ee39`, the script Marasi's Release and Nightly workflows use to publish the CLI as archives. Each archive packs a small stand-in CLI, the shell script `#!/bin/sh` followed by `# Marasi CLI archive fixture: <build>`, under the file name its platform uses.

| Archive | Built on | Holds |
|---|---|---|
| `marasi-darwin-arm64.zip` | macOS (`ditto`, as on `macos-latest`) | `marasi` |
| `marasi-linux-amd64.tar.gz` | `ubuntu:24.04` (`tar`, as on `ubuntu-latest`) | `marasi` |
| `marasi-windows-amd64.zip` | `ubuntu:24.04` (`zip`, as on `ubuntu-latest`) | `marasi.exe` |

To rebuild them, write each stand-in to `dist/<build>`, then run `scripts/archive-cli.sh dist/<build>` on the platform in the table.
