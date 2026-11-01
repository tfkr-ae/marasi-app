#!/bin/sh

# Builds the -tags server binary that launch runs: the frontend, the bindings
# and bin/marasi-app-server, through the Taskfile's build:server task.
set -eu
. "$(dirname -- "$0")/common.sh"

require_tools go node wails3
cd "$REPO_ROOT"
GOWORK=off wails3 task build:server DEV=true
check_build
printf 'Built %s\n' "$BUILD_BIN"
