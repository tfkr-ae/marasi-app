#!/bin/sh
# Prepares a fresh worktree so that `npm test`, `npm run dev` and the dist
# scripts run: installs the Electron shell's and the frontend's packages.
# Safe to run again.
set -eu

cd "$(dirname "$0")/.."

npm ci
(cd frontend && npm ci)
