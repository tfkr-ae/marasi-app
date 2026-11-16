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
SERVER_PORT=$(recorded_server_port)
SERVICE_MODE=$(cat "$SERVICE_MODE_FILE" 2>/dev/null || printf attach)
CLI_SOURCE=$(readlink "$CLI_BIN" 2>/dev/null || true)
# Chrome's profile is kept, as the desktop web view keeps its storage: the
# colour scheme the researcher chose lives in the page's localStorage. Close
# Chrome through CDP first, since a TERM drops what it hasn't written yet, and
# wait for it to exit; then only the old session's port and lock files go.
OLD_CHROME_PID=$(cat "$CHROME_PID_FILE" 2>/dev/null || true)
node "$SCRIPT_DIR/cdp.mjs" close "$(cat "$CDP_PORT_FILE" 2>/dev/null || printf 0)" "$(app_url)" "$(evidence_dir)" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" >/dev/null 2>&1 || true
ATTEMPTS=0
while [ -n "$OLD_CHROME_PID" ] && kill -0 "$OLD_CHROME_PID" 2>/dev/null && [ "$ATTEMPTS" -lt 10 ]; do
	sleep 1
	ATTEMPTS=$((ATTEMPTS + 1))
done
stop_instance
rm -f "$STATE_DIR/chrome/DevToolsActivePort" "$STATE_DIR/chrome/SingletonLock" "$STATE_DIR/chrome/SingletonSocket" "$STATE_DIR/chrome/SingletonCookie"
rm -f "$PID_FILE" "$CHROME_PID_FILE" "$CDP_PORT_FILE" "$PORT_FILE" "$SERVER_PORT_FILE" "$EVIDENCE_FILE" "$APP_BIN" "$SERVICE_PID_FILE" "$CONTROL_URL_FILE" "$SERVICE_PASSWORD_FILE" "$SERVICE_MODE_FILE"
# The service's config dir (and its project) is kept, and started again.
[ "$SERVICE_MODE" = app ] && PORT=
MARASI_VERIFY_CLI=${MARASI_VERIFY_CLI:-$CLI_SOURCE} MARASI_VERIFY_SERVICE=$SERVICE_MODE MARASI_VERIFY_PROXY_PORT=$PORT MARASI_VERIFY_SERVER_PORT=$SERVER_PORT MARASI_VERIFY_KEEP_CONFIG=1 exec "$SCRIPT_DIR/launch.sh"
