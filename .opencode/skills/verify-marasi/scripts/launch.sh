#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

PORT=${MARASI_VERIFY_PROXY_PORT:-18080}
DEV_PORT=${MARASI_VERIFY_DEV_PORT:-34115}
CDP_PORT=${MARASI_VERIFY_CDP_PORT:-0}
CHROME_BIN=${MARASI_VERIFY_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}

if [ -f "$PID_FILE" ]; then
	OLD_PID=$(cat "$PID_FILE")
	if kill -0 "$OLD_PID" 2>/dev/null; then
		printf 'Verification instance PID %s is already running. Use doctor.sh or cleanup.sh.\n' "$OLD_PID" >&2
		exit 1
	fi
	printf 'Stale verification state exists at %s. Run cleanup.sh before launching.\n' "$STATE_DIR" >&2
	exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
	printf 'Proxy port %s is already in use. Set MARASI_VERIFY_PROXY_PORT to a free port.\n' "$PORT" >&2
	exit 1
fi
for RESERVED_PORT in 5173 "$DEV_PORT"; do
	if lsof -nP -iTCP:"$RESERVED_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
		printf 'Verification port %s is already in use. Stop that process or choose another configurable port.\n' "$RESERVED_PORT" >&2
		exit 1
	fi
done
if [ "$CDP_PORT" -ne 0 ] && lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
	printf 'Chrome DevTools port %s is already in use. Set MARASI_VERIFY_CDP_PORT to 0 for automatic allocation.\n' "$CDP_PORT" >&2
	exit 1
fi
[ -x "$CHROME_BIN" ] || {
	printf 'Chrome executable not found at %s. Set MARASI_VERIFY_CHROME_BIN.\n' "$CHROME_BIN" >&2
	exit 1
}

mkdir -p "$STATE_DIR" "$APP_CONFIG_DIR" "$EVIDENCE_ROOT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP
mkdir "$EVIDENCE_DIR"
printf '%s\n' "$EVIDENCE_DIR" > "$EVIDENCE_FILE"
printf '%s\n' "$PORT" > "$PORT_FILE"
printf '%s\n' "$DEV_PORT" > "$DEV_PORT_FILE"

cat > "$APP_CONFIG_DIR/marasi_appconfig.yaml" <<EOF
default_address: 127.0.0.1
default_port: "$PORT"
first_run: false
syntax_mode: auto
vim_enabled: true
EOF

cd "$REPO_ROOT"
{
	printf 'command=wails dev -m -nosyncgomod -nocolour -devserver localhost:%s\n' "$DEV_PORT"
	printf 'started_at=%s\n' "$STAMP"
	printf 'state_dir=%s\n' "$STATE_DIR"
	printf 'isolated_home=%s\n' "$HOME_DIR"
	printf 'proxy_port=%s\n' "$PORT"
	printf 'dev_server=http://localhost:%s\n' "$DEV_PORT"
	printf 'requested_cdp_port=%s\n' "$CDP_PORT"
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
} > "$EVIDENCE_DIR/launch.txt"

GOCACHE_VALUE=$(go env GOCACHE)
GOMODCACHE_VALUE=$(go env GOMODCACHE)
HOME="$HOME_DIR" GOCACHE="$GOCACHE_VALUE" GOMODCACHE="$GOMODCACHE_VALUE" wails dev -m -nosyncgomod -nocolour -devserver "localhost:$DEV_PORT" > "$EVIDENCE_DIR/app.log" 2>&1 &
PID=$!
printf '%s\n' "$PID" > "$PID_FILE"
printf 'pid=%s\n' "$PID" >> "$EVIDENCE_DIR/launch.txt"

ATTEMPTS=0
while [ "$ATTEMPTS" -lt 120 ]; do
	if ! kill -0 "$PID" 2>/dev/null; then
		printf 'Marasi exited during startup. See %s/app.log\n' "$EVIDENCE_DIR" >&2
		exit 1
	fi
	if curl --fail --silent --output /dev/null "http://localhost:$DEV_PORT"; then
		break
	fi
	ATTEMPTS=$((ATTEMPTS + 1))
	sleep 1
done

if [ "$ATTEMPTS" -ge 120 ]; then
	printf 'Wails dev server did not become ready within 120 seconds. See %s\n' "$EVIDENCE_DIR" >&2
	exit 1
fi

"$CHROME_BIN" --headless=new --disable-gpu --no-first-run --no-default-browser-check --window-size="$VIEWPORT_WIDTH,$VIEWPORT_HEIGHT" --remote-debugging-port="$CDP_PORT" --user-data-dir="$STATE_DIR/chrome" about:blank > "$EVIDENCE_DIR/chrome.log" 2>&1 &
CHROME_PID=$!
printf '%s\n' "$CHROME_PID" > "$CHROME_PID_FILE"
printf 'chrome_pid=%s\n' "$CHROME_PID" >> "$EVIDENCE_DIR/launch.txt"

ATTEMPTS=0
while [ "$ATTEMPTS" -lt 30 ]; do
	if [ -f "$STATE_DIR/chrome/DevToolsActivePort" ]; then
		CDP_PORT=$(sed -n '1p' "$STATE_DIR/chrome/DevToolsActivePort")
		printf '%s\n' "$CDP_PORT" > "$CDP_PORT_FILE"
	fi
	if [ "$CDP_PORT" -ne 0 ] && curl --fail --silent --output /dev/null "http://127.0.0.1:$CDP_PORT/json/version"; then
		break
	fi
	ATTEMPTS=$((ATTEMPTS + 1))
	sleep 1
done
[ "$ATTEMPTS" -lt 30 ] || {
	printf 'Chrome DevTools endpoint did not become ready. See %s/chrome.log\n' "$EVIDENCE_DIR" >&2
	exit 1
}

node "$SCRIPT_DIR/cdp.mjs" launch "$CDP_PORT" "http://localhost:$DEV_PORT" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
LISTENER_PID=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN | head -n 1)
[ -n "$LISTENER_PID" ] && is_descendant_of "$LISTENER_PID" "$PID" || {
	printf 'Proxy port %s is not owned by a child of Wails PID %s.\n' "$PORT" "$PID" >&2
	exit 1
}
printf 'cdp_port=%s\n' "$CDP_PORT" >> "$EVIDENCE_DIR/launch.txt"
printf 'listener_pid=%s\n' "$LISTENER_PID" >> "$EVIDENCE_DIR/launch.txt"
printf 'ready=true\n' >> "$EVIDENCE_DIR/launch.txt"
printf 'Marasi dev PID %s is ready at http://localhost:%s with proxy 127.0.0.1:%s\nEvidence: %s\n' "$PID" "$DEV_PORT" "$PORT" "$EVIDENCE_DIR"
