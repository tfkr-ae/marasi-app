#!/bin/sh
# Benchmarks the Ledger in the running instance against its performance
# budget, after restarting it (the project is kept). Seed the project first with bench-seed.sh. Writes
# <evidence>/bench-ledger.json and exits 1 when a figure is over budget.
set -eu
. "$(dirname -- "$0")/common.sh"

[ -f "$CDP_PORT_FILE" ] || {
	printf 'No verification instance; run launch.sh first\n' >&2
	exit 1
}
# A fresh launch, so the first visit loads the Ledger's code as a user's would.
"$SCRIPT_DIR/restart.sh" >/dev/null
EVIDENCE_DIR=$(evidence_dir)
exec node "$SCRIPT_DIR/bench-ledger.mjs" "$(cat "$CDP_PORT_FILE")" "$EVIDENCE_DIR/bench-ledger.json" "$STATE_DIR"
