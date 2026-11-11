#!/bin/sh
# Runs every check CI runs: go vet and the Go tests, then the frontend tests
# and svelte-check. It assumes scripts/bootstrap.sh has run in this checkout.
set -eu

cd "$(dirname "$0")/.."

step() {
	printf '\n==> %s\n' "$1"
}

step 'go vet'
GOWORK=off go vet ./...

step 'go test'
GOWORK=off go test ./...

cd frontend

step 'npm test'
npm test

step 'npm run check'
npm run check

printf '\nAll checks passed.\n'
