#!/bin/sh
# Dismisses a modal, command palette, or drawer an earlier drive left open,
# then requires a healthy doctor.
set -eu
. "$(dirname -- "$0")/common.sh"

node "$SCRIPT_DIR/cdp.mjs" reset "$(cdp_port)" "$(app_url)" "$(evidence_dir)" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
"$SCRIPT_DIR/doctor.sh" >/dev/null
printf 'status=healthy after reset\n'
