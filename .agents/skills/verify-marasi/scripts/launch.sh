#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

# Ports default to free ones from the OS, so parallel sessions never share one.
PORT=${MARASI_VERIFY_PROXY_PORT:-}
SERVER_PORT=${MARASI_VERIFY_SERVER_PORT:-}
CDP_PORT=${MARASI_VERIFY_CDP_PORT:-0}
CHROME_BIN=${MARASI_VERIFY_CHROME_BIN:-}
if [ -z "$CHROME_BIN" ]; then
	if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
		CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	elif command -v google-chrome >/dev/null 2>&1; then
		CHROME_BIN=$(command -v google-chrome)
	elif command -v chromium >/dev/null 2>&1; then
		CHROME_BIN=$(command -v chromium)
	else
		CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	fi
fi

if [ -f "$PID_FILE" ]; then
	OLD_PID=$(cat "$PID_FILE")
	if kill -0 "$OLD_PID" 2>/dev/null; then
		printf 'Verification instance PID %s is already running in %s. Use doctor.sh or cleanup.sh, or set MARASI_VERIFY_STATE_DIR for a second session.\n' "$OLD_PID" "$STATE_DIR" >&2
		exit 1
	fi
	printf 'Stale verification state exists at %s. Run cleanup.sh before launching.\n' "$STATE_DIR" >&2
	exit 1
fi

# A kept config already names the port Marasi listens on.
if [ -z "$PORT" ] && [ "${MARASI_VERIFY_KEEP_CONFIG:-0}" = 1 ] && [ -f "$APP_CONFIG_DIR/marasi_appconfig.yaml" ]; then
	PORT=$(sed -n 's/^default_port: *"\{0,1\}\([0-9]*\)"\{0,1\}$/\1/p' "$APP_CONFIG_DIR/marasi_appconfig.yaml")
fi
preflight "Proxy=$PORT" "Server=$SERVER_PORT" "Chrome DevTools=$CDP_PORT"
[ -n "$PORT" ] || PORT=$(free_port)
[ -n "$SERVER_PORT" ] || SERVER_PORT=$(free_port)
[ "$PORT" != "$SERVER_PORT" ] || {
	printf 'Proxy and server ports are both %s.\n' "$PORT" >&2
	exit 1
}
# Chrome asked for port 0 can take the free port just picked for the proxy,
# which Marasi binds only once the page starts the listener; then the page
# stays on "Starting...". Pick DevTools' port here, apart from both.
if [ "$CDP_PORT" = 0 ]; then
	CDP_PORT=$(free_port)
	while [ "$CDP_PORT" = "$PORT" ] || [ "$CDP_PORT" = "$SERVER_PORT" ]; do
		CDP_PORT=$(free_port)
	done
fi
[ -x "$CHROME_BIN" ] || {
	printf 'Chrome executable not found at %s. Set MARASI_VERIFY_CHROME_BIN.\n' "$CHROME_BIN" >&2
	exit 1
}

mkdir -p "$STATE_DIR" "$APP_CONFIG_DIR" "$EVIDENCE_ROOT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP
# Two sessions can launch in the same second; each needs its own directory.
SUFFIX=1
while ! mkdir "$EVIDENCE_DIR" 2>/dev/null; do
	SUFFIX=$((SUFFIX + 1))
	EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP-$SUFFIX
done
printf '%s\n' "$EVIDENCE_DIR" > "$EVIDENCE_FILE"
printf '%s\n' "$PORT" > "$PORT_FILE"
printf '%s\n' "$SERVER_PORT" > "$SERVER_PORT_FILE"
cp "$BUILD_BIN" "$APP_BIN"

# restart.sh relaunches with MARASI_VERIFY_KEEP_CONFIG=1 so saved preferences survive.
if [ "${MARASI_VERIFY_KEEP_CONFIG:-0}" = 1 ] && [ -f "$APP_CONFIG_DIR/marasi_appconfig.yaml" ]; then
	printf 'Keeping existing config %s\n' "$APP_CONFIG_DIR/marasi_appconfig.yaml"
else
	cat > "$APP_CONFIG_DIR/marasi_appconfig.yaml" <<EOF
default_address: 127.0.0.1
default_port: "$PORT"
first_run: false
syntax_mode: auto
vim_enabled: true
EOF
fi

APP_URL=http://$SERVER_HOST:$SERVER_PORT
{
	printf 'command=%s\n' "$APP_BIN"
	printf 'build=%s\n' "$BUILD_BIN"
	printf 'build_modified=%s\n' "$(date -u -r "$BUILD_BIN" +%Y-%m-%dT%H:%M:%SZ)"
	printf 'started_at=%s\n' "$STAMP"
	printf 'state_dir=%s\n' "$STATE_DIR"
	printf 'isolated_home=%s\n' "$HOME_DIR"
	printf 'proxy_port=%s\n' "$PORT"
	printf 'app_url=%s\n' "$APP_URL"
	printf 'requested_cdp_port=%s\n' "$CDP_PORT"
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
} > "$EVIDENCE_DIR/launch.txt"

# The app's working directory is the isolated home, so nothing it writes
# lands in the checkout.
(cd "$HOME_DIR" && HOME="$HOME_DIR" WAILS_SERVER_HOST="$SERVER_HOST" WAILS_SERVER_PORT="$SERVER_PORT" exec "$APP_BIN") > "$EVIDENCE_DIR/app.log" 2>&1 &
PID=$!
printf '%s\n' "$PID" > "$PID_FILE"
printf 'pid=%s\n' "$PID" >> "$EVIDENCE_DIR/launch.txt"

ATTEMPTS=0
while [ "$ATTEMPTS" -lt 30 ]; do
	if ! kill -0 "$PID" 2>/dev/null; then
		printf 'Marasi exited during startup. See %s/app.log\n' "$EVIDENCE_DIR" >&2
		exit 1
	fi
	if curl --fail --silent --output /dev/null "$APP_URL/health"; then
		break
	fi
	ATTEMPTS=$((ATTEMPTS + 1))
	sleep 1
done
[ "$ATTEMPTS" -lt 30 ] || {
	printf 'Marasi server did not answer %s/health within 30 seconds. See %s/app.log\n' "$APP_URL" "$EVIDENCE_DIR" >&2
	exit 1
}

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
# A port chosen here (or by MARASI_VERIFY_CDP_PORT) can answer before Chrome
# writes DevToolsActivePort, so record it once the endpoint is up.
printf '%s\n' "$CDP_PORT" > "$CDP_PORT_FILE"

node "$SCRIPT_DIR/cdp.mjs" launch "$CDP_PORT" "$APP_URL" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
LISTENER_PID=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN | head -n 1)
[ "$LISTENER_PID" = "$PID" ] || {
	printf 'Proxy port %s is not owned by Marasi PID %s (owner: %s).\n' "$PORT" "$PID" "${LISTENER_PID:-none}" >&2
	exit 1
}
printf 'cdp_port=%s\n' "$CDP_PORT" >> "$EVIDENCE_DIR/launch.txt"
printf 'ready=true\n' >> "$EVIDENCE_DIR/launch.txt"
printf 'Marasi server PID %s is ready at %s with proxy 127.0.0.1:%s\nState: %s\nEvidence: %s\n' "$PID" "$APP_URL" "$PORT" "$STATE_DIR" "$EVIDENCE_DIR"
