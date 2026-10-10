#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

stop_instance

rm -rf "$STATE_DIR"
printf 'Removed verification state: %s\nEvidence retained under: %s\n' "$STATE_DIR" "$EVIDENCE_ROOT"
