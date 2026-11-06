#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

# Ports default to free ones from the OS, so parallel sessions never share one.
PORT=${MARASI_VERIFY_PROXY_PORT:-}
SERVER_PORT=${MARASI_VERIFY_SERVER_PORT:-}
CDP_PORT=${MARASI_VERIFY_CDP_PORT:-0}
CHROME_BIN=${MARASI_VERIFY_CHROME_BIN:-}
# attach: launch starts the service and the app attaches to it (the
# default). app: the app starts it, and stops it when it quits.
SERVICE_MODE=${MARASI_VERIFY_SERVICE:-attach}
case $SERVICE_MODE in
	attach | app) ;;
	*)
		printf 'MARASI_VERIFY_SERVICE must be attach or app, not %s.\n' "$SERVICE_MODE" >&2
		exit 1
		;;
esac
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
resolve_cli
# The app starts its own instance with a free proxy port (--port 0), read
# back once the page is ready.
[ "$SERVICE_MODE" = app ] || [ -n "$PORT" ] || PORT=$(free_port)
[ -n "$SERVER_PORT" ] || SERVER_PORT=$(free_port)
[ -z "$PORT" ] || [ "$PORT" != "$SERVER_PORT" ] || {
	printf 'Proxy and server ports are both %s.\n' "$PORT" >&2
	exit 1
}
# Chrome asked for port 0 can take the free port just picked for the proxy,
# which Marasi binds only once the page starts the listener; then the page
# stays on "Starting...". Pick DevTools' port here, apart from both.
if [ "$CDP_PORT" = 0 ]; then
	CDP_PORT=$(free_port)
	while [ "$CDP_PORT" = "${PORT:-}" ] || [ "$CDP_PORT" = "$SERVER_PORT" ]; do
		CDP_PORT=$(free_port)
	done
fi
[ -x "$CHROME_BIN" ] || {
	printf 'Chrome executable not found at %s. Set MARASI_VERIFY_CHROME_BIN.\n' "$CHROME_BIN" >&2
	exit 1
}

mkdir -p "$STATE_DIR" "$APP_CONFIG_DIR" "$EVIDENCE_ROOT" "$SERVICE_DIR" "$CLI_DIR"
ln -sf "$CLI_SOURCE" "$CLI_BIN"
printf '%s\n' "$SERVICE_MODE" > "$SERVICE_MODE_FILE"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP
# Two sessions can launch in the same second; each needs its own directory.
SUFFIX=1
while ! mkdir "$EVIDENCE_DIR" 2>/dev/null; do
	SUFFIX=$((SUFFIX + 1))
	EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP-$SUFFIX
done
printf '%s\n' "$EVIDENCE_DIR" > "$EVIDENCE_FILE"
[ -z "$PORT" ] || printf '%s\n' "$PORT" > "$PORT_FILE"
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
	printf 'marasi_cli=%s\n' "$CLI_SOURCE"
	printf 'service_mode=%s\n' "$SERVICE_MODE"
	printf 'service_config_dir=%s\n' "$SERVICE_DIR"
	printf 'app_url=%s\n' "$APP_URL"
	printf 'requested_cdp_port=%s\n' "$CDP_PORT"
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
} > "$EVIDENCE_DIR/launch.txt"

# In attach mode, start the isolated instance the way a researcher would from
# a terminal, with a control password, before the app opens.
if [ "$SERVICE_MODE" = attach ]; then
	if [ "$(service_state)" = running ]; then
		printf 'A Marasi instance already runs in %s. Run cleanup.sh first.\n' "$SERVICE_DIR" >&2
		exit 1
	fi
	PASSWORD=$(node -e 'console.log(require("node:crypto").randomBytes(18).toString("base64url"))')
	(umask 077 && printf '%s\n' "$PASSWORD" > "$SERVICE_PASSWORD_FILE")
	MARASI_PASSWORD=$PASSWORD "$CLI_BIN" --config-dir "$SERVICE_DIR" --instance default service start --json --port "$PORT" --control-address 127.0.0.1:0 > "$EVIDENCE_DIR/service-start.json" 2>&1 || {
		printf 'Starting the Marasi service failed: %s\n' "$(cat "$EVIDENCE_DIR/service-start.json")" >&2
		exit 1
	}
fi

# The app's working directory is the isolated home, so nothing it writes
# lands in the checkout. It finds the linked CLI first on PATH, and points
# every CLI call at the isolated config dir.
(cd "$HOME_DIR" && HOME="$HOME_DIR" PATH="$CLI_DIR:$PATH" MARASI_APP_CLI_CONFIG_DIR="$SERVICE_DIR" WAILS_SERVER_HOST="$SERVER_HOST" WAILS_SERVER_PORT="$SERVER_PORT" exec "$APP_BIN") > "$EVIDENCE_DIR/app.log" 2>&1 &
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
# The instance the page reached: its status, its proxy port, and its
# control address and password (from the pairing, over its socket), which
# recipes use to drive the service from outside the app.
marasi_cli service status --json > "$EVIDENCE_DIR/service-status.json"
PROXY_LISTENER=$(json_field proxy_listener < "$EVIDENCE_DIR/service-status.json")
SERVICE_PORT=${PROXY_LISTENER##*:}
[ -z "$PORT" ] || [ "$SERVICE_PORT" = "$PORT" ] || {
	printf 'The service listens on %s, not the proxy port %s.\n' "$PROXY_LISTENER" "$PORT" >&2
	exit 1
}
PORT=$SERVICE_PORT
printf '%s\n' "$PORT" > "$PORT_FILE"
marasi_cli service control pair --json > "$STATE_DIR/pairing.json"
json_field url < "$STATE_DIR/pairing.json" > "$CONTROL_URL_FILE"
(umask 077 && json_field password < "$STATE_DIR/pairing.json" > "$SERVICE_PASSWORD_FILE")
rm -f "$STATE_DIR/pairing.json"
SERVICE_PID=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN | head -n 1)
[ -n "$SERVICE_PID" ] && [ "$SERVICE_PID" != "$PID" ] || {
	printf 'Proxy port %s is not owned by a Marasi service process (owner: %s; the app is PID %s, which must not run a proxy).\n' "$PORT" "${SERVICE_PID:-none}" "$PID" >&2
	exit 1
}
printf '%s\n' "$SERVICE_PID" > "$SERVICE_PID_FILE"
printf 'proxy_port=%s\nservice_pid=%s\ncontrol_url=%s\n' "$PORT" "$SERVICE_PID" "$(cat "$CONTROL_URL_FILE")" >> "$EVIDENCE_DIR/launch.txt"
printf 'cdp_port=%s\n' "$CDP_PORT" >> "$EVIDENCE_DIR/launch.txt"
printf 'ready=true\n' >> "$EVIDENCE_DIR/launch.txt"
printf 'Marasi server PID %s is ready at %s, on the Marasi service PID %s (%s, proxy 127.0.0.1:%s, control %s)\nState: %s\nEvidence: %s\n' "$PID" "$APP_URL" "$SERVICE_PID" "$SERVICE_MODE" "$PORT" "$(cat "$CONTROL_URL_FILE")" "$STATE_DIR" "$EVIDENCE_DIR"
