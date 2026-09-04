#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

PID=$(recorded_pid)
PORT=$(recorded_port)
DEV_PORT=$(recorded_dev_port)
EVIDENCE_DIR=$(evidence_dir)
CDP_PORT=$(cat "$CDP_PORT_FILE")
CHROME_PID=$(cat "$CHROME_PID_FILE")

kill -0 "$PID"
kill -0 "$CHROME_PID"
EXECUTABLE=$(ps -p "$PID" -o comm=)
curl --fail --silent --output /dev/null "http://localhost:$DEV_PORT"
curl --fail --silent --output /dev/null "http://127.0.0.1:$CDP_PORT/json/version"
LISTENER_PID=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN | head -n 1)
[ -n "$LISTENER_PID" ]
is_descendant_of "$LISTENER_PID" "$PID"
[ -f "$APP_CONFIG_DIR/marasi_appconfig.yaml" ]
[ -f "$APP_CONFIG_DIR/scratchpad.marasi" ]

node "$SCRIPT_DIR/cdp.mjs" doctor "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" >/dev/null

{
	printf 'status=healthy\n'
	printf 'pid=%s\n' "$PID"
	printf 'executable=%s\n' "$EXECUTABLE"
	printf 'browser_state=app rail ready with Wails bridge\n'
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
	printf 'dev_server=http://localhost:%s\n' "$DEV_PORT"
	printf 'cdp_endpoint=http://127.0.0.1:%s\n' "$CDP_PORT"
	printf 'proxy_listener=127.0.0.1:%s\n' "$PORT"
	printf 'listener_pid=%s\n' "$LISTENER_PID"
	printf 'config=%s\n' "$APP_CONFIG_DIR/marasi_appconfig.yaml"
	printf 'project=%s\n' "$APP_CONFIG_DIR/scratchpad.marasi"
	printf 'evidence=%s\n' "$EVIDENCE_DIR"
} | tee "$EVIDENCE_DIR/doctor.txt"
