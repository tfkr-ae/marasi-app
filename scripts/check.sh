#!/bin/sh
# Runs every check CI runs: go vet and the Go tests, then the frontend tests
# and svelte-check. It assumes scripts/bootstrap.sh has run in this checkout.
# GO_TEST_FLAGS adds go test flags; CI sets it to -race.
set -eu

cd "$(dirname "$0")/.."

step() {
	printf '\n==> %s\n' "$1"
}

step 'go vet'
GOWORK=off go vet ./...

step 'go test'
# shellcheck disable=SC2086 # GO_TEST_FLAGS holds several flags
GOWORK=off go test ${GO_TEST_FLAGS:-} ./...

cd frontend

step 'npm test'
npm test

step 'npm run check'
npm run check

printf '\nAll checks passed.\n'
