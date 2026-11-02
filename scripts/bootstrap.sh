#!/bin/sh
# Prepares a fresh worktree so that `GOWORK=off go vet ./...`, the Go tests
# and `wails3 build` run. main.go embeds all:frontend/build, which must exist
# and hold a file; the frontend needs node_modules; and wails3 generates the
# bindings in frontend/src/lib/bindings. It installs wails3 at the version
# go.mod pins when that version isn't on PATH. Safe to run again.
set -eu

cd "$(dirname "$0")/.."

mkdir -p frontend/build
if [ -z "$(ls -A frontend/build)" ]; then
	touch frontend/build/.gitkeep
fi

(cd frontend && npm ci)

wails_version=$(GOWORK=off go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3)
if ! command -v wails3 >/dev/null 2>&1 || [ "$(wails3 version 2>&1)" != "$wails_version" ]; then
	GOWORK=off go install "github.com/wailsapp/wails/v3/cmd/wails3@$wails_version"
	gobin=$(go env GOBIN)
	PATH="${gobin:-$(go env GOPATH)/bin}:$PATH"
fi

GOWORK=off wails3 generate bindings -d frontend/src/lib/bindings
