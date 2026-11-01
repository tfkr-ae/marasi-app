#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

# Before launch, check what launch needs: tools, a current server build, and
# free ports for any that are set.
if [ ! -f "$PID_FILE" ]; then
	preflight "Proxy=${MARASI_VERIFY_PROXY_PORT:-}" "Server=${MARASI_VERIFY_SERVER_PORT:-}" "Chrome DevTools=${MARASI_VERIFY_CDP_PORT:-}"
	printf 'status=ready to launch\nbuild=%s\nstate_dir=%s\n' "$BUILD_BIN" "$STATE_DIR"
	exit 0
fi

require_tools lsof curl node
PID=$(recorded_pid)
PORT=$(recorded_port)
SERVER_PORT=$(recorded_server_port)
APP_URL=$(app_url)
EVIDENCE_DIR=$(evidence_dir)
CDP_PORT=$(cat "$CDP_PORT_FILE")
CHROME_PID=$(cat "$CHROME_PID_FILE")

fail() {
	printf 'doctor: %s\n' "$1" >&2
	exit 1
}

kill -0 "$PID" 2>/dev/null || fail "Marasi PID $PID is not running. See $EVIDENCE_DIR/app.log, then run cleanup.sh and relaunch."
kill -0 "$CHROME_PID" 2>/dev/null || fail "Chrome PID $CHROME_PID is not running. Run cleanup.sh and relaunch."
[ -x "$APP_BIN" ] || fail "The running build $APP_BIN is missing. Run cleanup.sh, build.sh and launch.sh."
EXECUTABLE=$(ps -p "$PID" -o comm=)
SERVER_PID=$(lsof -nP -t -iTCP:"$SERVER_PORT" -sTCP:LISTEN | head -n 1)
[ "$SERVER_PID" = "$PID" ] || fail "Server port $SERVER_PORT is owned by ${SERVER_PID:-nothing}, not Marasi PID $PID."
curl --fail --silent --output /dev/null "$APP_URL/health" || fail "$APP_URL/health does not answer."
curl --fail --silent --output /dev/null "http://127.0.0.1:$CDP_PORT/json/version" || fail "Chrome DevTools does not answer on port $CDP_PORT."
LISTENER_PID=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN | head -n 1)
[ "$LISTENER_PID" = "$PID" ] || fail "Proxy port $PORT is owned by ${LISTENER_PID:-nothing}, not Marasi PID $PID."
[ -f "$APP_CONFIG_DIR/marasi_appconfig.yaml" ] || fail "No isolated config at $APP_CONFIG_DIR/marasi_appconfig.yaml."
[ -f "$APP_CONFIG_DIR/scratchpad.marasi" ] || fail "No scratch project at $APP_CONFIG_DIR/scratchpad.marasi."

node "$SCRIPT_DIR/cdp.mjs" doctor "$CDP_PORT" "$APP_URL" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" >/dev/null

{
	printf 'status=healthy\n'
	printf 'pid=%s\n' "$PID"
	printf 'executable=%s\n' "$EXECUTABLE"
	printf 'browser_state=app rail ready with the Wails runtime and events socket\n'
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
	printf 'app_url=%s\n' "$APP_URL"
	printf 'cdp_endpoint=http://127.0.0.1:%s\n' "$CDP_PORT"
	printf 'proxy_listener=127.0.0.1:%s\n' "$PORT"
	printf 'config=%s\n' "$APP_CONFIG_DIR/marasi_appconfig.yaml"
	printf 'project=%s\n' "$APP_CONFIG_DIR/scratchpad.marasi"
	printf 'evidence=%s\n' "$EVIDENCE_DIR"
} | tee "$EVIDENCE_DIR/doctor.txt"
