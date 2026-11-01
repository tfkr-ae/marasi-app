#!/bin/sh
# Prepares a fresh worktree so that `GOWORK=off go vet ./...` and the Go tests
# run. main.go embeds all:frontend/build, which must exist and hold a file;
# the frontend needs node_modules; and wails generates
# frontend/src/lib/wailsjs. Safe to run again.
set -eu

cd "$(dirname "$0")/.."

mkdir -p frontend/build
if [ -z "$(ls -A frontend/build)" ]; then
	touch frontend/build/.gitkeep
fi

(cd frontend && npm ci)

GOWORK=off wails generate module
