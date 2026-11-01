#!/bin/sh

# Restart the recorded instance, keeping the isolated home so the app config
# and project written during this run are read again on the next start.
set -eu
. "$(dirname -- "$0")/common.sh"

[ -f "$PID_FILE" ] || {
	printf 'No verification instance to restart at %s\n' "$STATE_DIR" >&2
	exit 1
}
PORT=$(recorded_port)
stop_instance
rm -rf "$STATE_DIR/chrome"
rm -f "$PID_FILE" "$CHROME_PID_FILE" "$CDP_PORT_FILE" "$PORT_FILE" "$DEV_PORT_FILE" "$EVIDENCE_FILE"
MARASI_VERIFY_PROXY_PORT=$PORT MARASI_VERIFY_KEEP_CONFIG=1 exec "$SCRIPT_DIR/launch.sh"
