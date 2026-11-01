#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

# Dismisses a modal, command palette, or drawer an earlier drive left open,
# then requires a healthy doctor.
PID=$(recorded_pid)
kill -0 "$PID"
kill -0 "$(cat "$CHROME_PID_FILE")"
EVIDENCE_DIR=$(evidence_dir)
CDP_PORT=$(cat "$CDP_PORT_FILE")
DEV_PORT=$(recorded_dev_port)
node "$SCRIPT_DIR/cdp.mjs" reset "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
"$SCRIPT_DIR/doctor.sh" >/dev/null
printf 'status=healthy after reset\n'
