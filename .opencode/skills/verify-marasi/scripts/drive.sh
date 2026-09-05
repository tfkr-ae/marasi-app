#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

FEATURE=${1:-}
ACTION=${2:-}
LABEL=${3:-}
SHORTCUT=${4:-}

usage() {
	printf 'Usage: %s {dashboard|ledger|compass|checkpoint|launchpad|armory|logbook|workshop|settings} [compare <label> <shortcut>|theme]\n' "$0" >&2
	exit 2
}

case "$FEATURE" in
	dashboard|ledger|compass|checkpoint|launchpad|armory|logbook|workshop|settings) ;;
	*) usage ;;
esac

if [ -n "$ACTION" ]; then
	if [ "$ACTION" = "compare" ]; then
		[ -n "$LABEL" ] && [ -n "$SHORTCUT" ] || usage
	else
		[ "$FEATURE" = "dashboard" ] && [ "$ACTION" = "theme" ] && [ -z "$LABEL" ] && [ -z "$SHORTCUT" ] || usage
	fi
fi

"$SCRIPT_DIR/doctor.sh" >/dev/null
EVIDENCE_DIR=$(evidence_dir)
CDP_PORT=$(cat "$CDP_PORT_FILE")
DEV_PORT=$(recorded_dev_port)
if [ "$ACTION" = "compare" ]; then
	node "$SCRIPT_DIR/cdp.mjs" drive "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" "$FEATURE" compare "$LABEL" "$SHORTCUT"
elif [ -n "$ACTION" ]; then
	node "$SCRIPT_DIR/cdp.mjs" drive "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" "$FEATURE" "$ACTION"
else
	node "$SCRIPT_DIR/cdp.mjs" drive "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" "$FEATURE"
fi
