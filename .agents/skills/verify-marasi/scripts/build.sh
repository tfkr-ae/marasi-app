#!/bin/sh

# Builds the -tags server binary that launch runs: the frontend, the bindings
# and bin/marasi-app-server, through the Taskfile's build:server task.
set -eu
. "$(dirname -- "$0")/common.sh"

require_tools go node wails3
cd "$REPO_ROOT"
# Marasi is cgo-free (modernc sqlite), but with cgo on, Wails' Linux webkit
# file (linux && cgo && !gtk3) still compiles into a server build and needs
# gtk4 and webkitgtk-6.0. Build the server without cgo on Linux unless the
# caller chose otherwise.
if [ "$(uname -s)" = Linux ]; then
	export CGO_ENABLED="${CGO_ENABLED:-0}"
fi
GOWORK=off wails3 task build:server DEV=true
check_build
printf 'Built %s\n' "$BUILD_BIN"
