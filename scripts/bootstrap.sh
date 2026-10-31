#!/bin/sh
# Prepares a fresh worktree so that `npm test`, `npm run dev` and the dist
# scripts run: installs the Electron shell's and the frontend's packages,
# and builds the bundled Marasi when it is missing and Go is installed.
# Safe to run again.
set -eu

cd "$(dirname "$0")/.."

npm ci
(cd frontend && npm ci)

if [ -e resources/bin/marasi ] || [ -e resources/bin/marasi.exe ]; then
	:
elif command -v go >/dev/null 2>&1; then
	sh scripts/build-marasi.sh
else
	echo "No Go: skipped the bundled Marasi; run npm run marasi to build it" >&2
fi
