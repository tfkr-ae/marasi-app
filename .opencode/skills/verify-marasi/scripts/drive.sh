#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

FEATURE=${1:-}
case "$FEATURE" in
	dashboard|ledger|compass|checkpoint|launchpad|armory|logbook|workshop|settings) ;;
	*)
		printf 'Usage: %s {dashboard|ledger|compass|checkpoint|launchpad|armory|logbook|workshop|settings}\n' "$0" >&2
		exit 2
		;;
esac

"$SCRIPT_DIR/doctor.sh" >/dev/null
EVIDENCE_DIR=$(evidence_dir)
CDP_PORT=$(cat "$CDP_PORT_FILE")
DEV_PORT=$(recorded_dev_port)
node "$SCRIPT_DIR/cdp.mjs" drive "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" "$FEATURE"
