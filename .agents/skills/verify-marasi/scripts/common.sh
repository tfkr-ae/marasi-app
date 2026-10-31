#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Node 20 needs --experimental-websocket for the global WebSocket used by cdp.mjs.
# Node 22+ exposes it by default; the flag remains harmless there.
case ${NODE_OPTIONS-} in
	*--experimental-websocket*) ;;
	*) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--experimental-websocket" ;;
esac
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)
STATE_DIR=${MARASI_VERIFY_STATE_DIR:-${TMPDIR:-/tmp}/verify-marasi}
EVIDENCE_ROOT=${MARASI_VERIFY_EVIDENCE_ROOT:-$REPO_ROOT/.artifacts/verify-marasi}
VIEWPORT_WIDTH=1600
VIEWPORT_HEIGHT=900
# The Marasi that runs the instance: MARASI_BIN, else the bundled one
# `npm run marasi` builds.
MARASI=${MARASI_BIN:-$REPO_ROOT/resources/bin/marasi}
INSTANCE=default
# Each file records what launch made, so later helpers act on it alone.
CONFIG_DIR_FILE=$STATE_DIR/config-dir
INSTANCE_FILE=$STATE_DIR/instance.json
VITE_PID_FILE=$STATE_DIR/vite.pid
DEV_PORT_FILE=$STATE_DIR/dev-port
CDP_PORT_FILE=$STATE_DIR/cdp-port
CHROME_PID_FILE=$STATE_DIR/chrome.pid
EVIDENCE_FILE=$STATE_DIR/evidence-dir

# Fail fast when a helper's tool is missing. Without lsof every port check
# reads as free.
require_tools() {
	for TOOL in "$@"; do
		command -v "$TOOL" >/dev/null 2>&1 || {
			printf 'Required tool %s is not on PATH.\n' "$TOOL" >&2
			exit 1
		}
	done
}

recorded() {
	[ -f "$1" ] || {
		printf 'No verification instance: %s is missing. Run launch.sh first.\n' "$1" >&2
		exit 1
	}
	cat "$1"
}

config_dir() { recorded "$CONFIG_DIR_FILE"; }
dev_port() { recorded "$DEV_PORT_FILE"; }
cdp_port() { recorded "$CDP_PORT_FILE"; }
evidence_dir() { recorded "$EVIDENCE_FILE"; }
app_url() { printf 'http://localhost:%s/\n' "$(dev_port)"; }

# A field of the instance's `service start --json` output.
instance_field() {
	node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]] ?? ""))' "$INSTANCE_FILE" "$1"
}

port_in_use() {
	lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# The first free port from $1 on.
free_port() {
	CANDIDATE=$1
	while port_in_use "$CANDIDATE"; do
		CANDIDATE=$((CANDIDATE + 1))
	done
	printf '%s\n' "$CANDIDATE"
}

find_chrome() {
	if [ -n "${MARASI_VERIFY_CHROME_BIN:-}" ]; then
		printf '%s\n' "$MARASI_VERIFY_CHROME_BIN"
	elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
		printf '%s\n' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	elif command -v google-chrome >/dev/null 2>&1; then
		command -v google-chrome
	elif command -v chromium >/dev/null 2>&1; then
		command -v chromium
	else
		printf '%s\n' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	fi
}

# Sends TERM to recorded PID file $1's process, then KILL if it is still up
# after 10 s.
stop_recorded() {
	[ -f "$1" ] || return 0
	PID=$(cat "$1")
	kill -0 "$PID" 2>/dev/null || return 0
	kill -TERM "$PID"
	ATTEMPTS=0
	while kill -0 "$PID" 2>/dev/null && [ "$ATTEMPTS" -lt 10 ]; do
		sleep 1
		ATTEMPTS=$((ATTEMPTS + 1))
	done
	if kill -0 "$PID" 2>/dev/null; then
		kill -KILL "$PID"
	fi
}

# Starts the dev server and Chrome on the recorded instance, and connects
# through the connection screen. Writes into evidence directory $1.
start_frontend() {
	EVIDENCE_DIR=$1
	CONFIG_DIR=$(config_dir)
	CHROME_BIN=$(find_chrome)
	[ -x "$CHROME_BIN" ] || {
		printf 'Chrome executable not found at %s. Set MARASI_VERIFY_CHROME_BIN.\n' "$CHROME_BIN" >&2
		exit 1
	}
	if [ -n "${MARASI_VERIFY_DEV_PORT:-}" ]; then
		DEV_PORT=$MARASI_VERIFY_DEV_PORT
		if port_in_use "$DEV_PORT"; then
			printf 'Dev server port %s is already in use. Unset MARASI_VERIFY_DEV_PORT to pick a free one.\n' "$DEV_PORT" >&2
			exit 1
		fi
	else
		DEV_PORT=$(free_port 5190)
	fi
	printf '%s\n' "$DEV_PORT" > "$DEV_PORT_FILE"

	# The dev server's bridge reaches only the instances in this config
	# directory (frontend/devBridge.js).
	(cd "$REPO_ROOT/frontend" && MARASI_CONFIG_DIR="$CONFIG_DIR" MARASI_DEV_PORT="$DEV_PORT" exec node node_modules/vite/bin/vite.js dev) > "$EVIDENCE_DIR/vite.log" 2>&1 &
	printf '%s\n' "$!" > "$VITE_PID_FILE"
	ATTEMPTS=0
	until curl --fail --silent --output /dev/null "http://localhost:$DEV_PORT/__marasi/connection"; do
		kill -0 "$(cat "$VITE_PID_FILE")" 2>/dev/null || {
			printf 'The dev server exited during startup. See %s/vite.log\n' "$EVIDENCE_DIR" >&2
			exit 1
		}
		ATTEMPTS=$((ATTEMPTS + 1))
		[ "$ATTEMPTS" -lt 60 ] || {
			printf 'The dev server did not answer within 60 s. See %s/vite.log\n' "$EVIDENCE_DIR" >&2
			exit 1
		}
		sleep 1
	done

	# restart.sh keeps the profile, and with it the page's light or dark
	# choice in localStorage.
	rm -rf "$STATE_DIR/chrome"
	if [ -n "${KEEP_CHROME_PROFILE:-}" ] && [ -d "$KEEP_CHROME_PROFILE" ]; then
		mv "$KEEP_CHROME_PROFILE" "$STATE_DIR/chrome"
		rm -f "$STATE_DIR/chrome/DevToolsActivePort"
	fi
	"$CHROME_BIN" --headless=new --disable-gpu --no-first-run --no-default-browser-check --window-size="$VIEWPORT_WIDTH,$VIEWPORT_HEIGHT" --remote-debugging-port=0 --user-data-dir="$STATE_DIR/chrome" about:blank > "$EVIDENCE_DIR/chrome.log" 2>&1 &
	printf '%s\n' "$!" > "$CHROME_PID_FILE"
	ATTEMPTS=0
	CDP_PORT=0
	while [ "$ATTEMPTS" -lt 30 ]; do
		if [ -f "$STATE_DIR/chrome/DevToolsActivePort" ]; then
			CDP_PORT=$(sed -n '1p' "$STATE_DIR/chrome/DevToolsActivePort")
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
	printf '%s\n' "$CDP_PORT" > "$CDP_PORT_FILE"
	{
		printf 'dev_server=http://localhost:%s/\n' "$DEV_PORT"
		printf 'vite_pid=%s\n' "$(cat "$VITE_PID_FILE")"
		printf 'chrome_pid=%s\n' "$(cat "$CHROME_PID_FILE")"
		printf 'cdp_port=%s\n' "$CDP_PORT"
	} >> "$EVIDENCE_DIR/launch.txt"

	node "$SCRIPT_DIR/cdp.mjs" launch "$CDP_PORT" "http://localhost:$DEV_PORT/" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT" "$INSTANCE"
}

# Stops the recorded Chrome and dev server, leaving the instance running.
stop_frontend() {
	stop_recorded "$CHROME_PID_FILE"
	stop_recorded "$VITE_PID_FILE"
	rm -f "$CHROME_PID_FILE" "$VITE_PID_FILE" "$CDP_PORT_FILE" "$DEV_PORT_FILE"
}
