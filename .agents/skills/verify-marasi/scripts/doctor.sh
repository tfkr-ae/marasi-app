#!/bin/sh
# Read-only: is the recorded instance, dev server and Chrome worth driving?
set -eu
. "$(dirname -- "$0")/common.sh"

require_tools lsof curl node
CONFIG_DIR=$(config_dir)
DEV_PORT=$(dev_port)
CDP_PORT=$(cdp_port)
EVIDENCE_DIR=$(evidence_dir)
VITE_PID=$(recorded "$VITE_PID_FILE")
CHROME_PID=$(recorded "$CHROME_PID_FILE")

fail() {
	printf 'doctor: %s\n' "$1" >&2
	exit 1
}

STATUS=$("$MARASI" --config-dir "$CONFIG_DIR" --instance "$INSTANCE" --json service status) || fail "instance $INSTANCE in $CONFIG_DIR is not answering on its socket"
printf '%s\n' "$STATUS" | grep -q '"status":"running"' || fail "instance $INSTANCE is not running: $STATUS"
kill -0 "$VITE_PID" 2>/dev/null || fail "dev server PID $VITE_PID is gone"
kill -0 "$CHROME_PID" 2>/dev/null || fail "Chrome PID $CHROME_PID is gone"
[ "$(lsof -nP -t -iTCP:"$DEV_PORT" -sTCP:LISTEN | head -n 1)" = "$VITE_PID" ] || fail "port $DEV_PORT is not owned by the recorded dev server PID $VITE_PID"
# The bridge's connection is the instance's, so calls reach it.
CONNECTION=$(curl --fail --silent "http://localhost:$DEV_PORT/__marasi/connection") || fail "the dev server's bridge is not answering"
printf '%s\n' "$CONNECTION" | grep -q "\"instance\":\"$INSTANCE\"" || fail "the dev server is not connected to $INSTANCE: $CONNECTION (relaunch)"
curl --fail --silent --output /dev/null "http://localhost:$DEV_PORT/__marasi/instance/service/status" || fail "calls through the bridge do not reach $INSTANCE"
curl --fail --silent --output /dev/null "http://127.0.0.1:$CDP_PORT/json/version" || fail "Chrome DevTools is not answering on $CDP_PORT"

node "$SCRIPT_DIR/cdp.mjs" doctor "$CDP_PORT" "$(app_url)" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" >/dev/null

{
	printf 'status=healthy\n'
	printf 'instance=%s\n' "$STATUS"
	printf 'config_dir=%s\n' "$CONFIG_DIR"
	printf 'dev_server=%s\n' "$(app_url)"
	printf 'vite_pid=%s\n' "$VITE_PID"
	printf 'bridge_connection=%s\n' "$CONNECTION"
	printf 'cdp_endpoint=http://127.0.0.1:%s\n' "$CDP_PORT"
	printf 'chrome_pid=%s\n' "$CHROME_PID"
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
	printf 'evidence=%s\n' "$EVIDENCE_DIR"
} | tee "$EVIDENCE_DIR/doctor.txt"
