#!/bin/sh
# Drives one mapped feature in the verification Chrome; see SKILL.md.
set -eu
. "$(dirname -- "$0")/common.sh"

FEATURE=${1:-}
ACTION=${2:-}
LABEL=${3:-}
SHORTCUT=${4:-}

usage() {
	printf 'Usage: %s {home|connection|ledger|compass|checkpoint|launchpad|armory|logbook|workshop|settings} [compare <label> <shortcut>|steps <json>|shots|theme]\n' "$0" >&2
	exit 2
}

case "$FEATURE" in
	home|connection|ledger|compass|checkpoint|launchpad|armory|logbook|workshop|settings) ;;
	*) usage ;;
esac

case "$ACTION" in
	"" | shots) [ -z "$LABEL" ] && [ -z "$SHORTCUT" ] || usage ;;
	compare) [ -n "$LABEL" ] && [ -n "$SHORTCUT" ] || usage ;;
	steps) [ -n "$LABEL" ] && [ -z "$SHORTCUT" ] || usage ;;
	theme) [ "$FEATURE" = home ] && [ -z "$LABEL" ] && [ -z "$SHORTCUT" ] || usage ;;
	*) usage ;;
esac

"$SCRIPT_DIR/doctor.sh" >/dev/null
node "$SCRIPT_DIR/cdp.mjs" drive "$(cdp_port)" "$(app_url)" "$(evidence_dir)" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" "$FEATURE" "$ACTION" "$LABEL" "$SHORTCUT"
