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
PID_FILE=$STATE_DIR/app.pid
PORT_FILE=$STATE_DIR/proxy-port
DEV_PORT_FILE=$STATE_DIR/dev-port
CDP_PORT_FILE=$STATE_DIR/cdp-port
CHROME_PID_FILE=$STATE_DIR/chrome.pid
EVIDENCE_FILE=$STATE_DIR/evidence-dir
HOME_DIR=$STATE_DIR/home
# Match os.UserConfigDir() under the isolated HOME: macOS Application Support,
# Linux/Windows .config. Doctor and launch seed the same path the app reads.
case $(uname -s) in
	Darwin) APP_CONFIG_DIR="$HOME_DIR/Library/Application Support/Marasi" ;;
	*) APP_CONFIG_DIR="$HOME_DIR/.config/Marasi" ;;
esac
APP_BIN=$REPO_ROOT/build/bin/marasi-app.app/Contents/MacOS/marasi-app

# Fail fast when a helper's tool is missing. Without lsof every port check
# reads as free and launch only fails after the app has started; without
# pkg-config the Linux Wails build fails and launch waits out its 120 s.
require_tools() {
	for TOOL in "$@"; do
		command -v "$TOOL" >/dev/null 2>&1 || {
			printf 'Required tool %s is not on PATH.' "$TOOL" >&2
			case $TOOL in
				wails) printf ' It is usually in %s/bin.' "$(go env GOPATH 2>/dev/null)" >&2 ;;
			esac
			printf '\n' >&2
			exit 1
		}
	done
}

recorded_pid() {
	[ -f "$PID_FILE" ] || {
		printf 'No verification PID at %s\n' "$PID_FILE" >&2
		exit 1
	}
	cat "$PID_FILE"
}

recorded_port() {
	[ -f "$PORT_FILE" ] || {
		printf 'No verification port at %s\n' "$PORT_FILE" >&2
		exit 1
	}
	cat "$PORT_FILE"
}

recorded_dev_port() {
	[ -f "$DEV_PORT_FILE" ] || {
		printf 'No Wails dev-server port at %s\n' "$DEV_PORT_FILE" >&2
		exit 1
	}
	cat "$DEV_PORT_FILE"
}

evidence_dir() {
	[ -f "$EVIDENCE_FILE" ] || {
		printf 'No evidence directory recorded at %s\n' "$EVIDENCE_FILE" >&2
		exit 1
	}
	cat "$EVIDENCE_FILE"
}

is_descendant_of() {
	CHILD_PID=$1
	ANCESTOR_PID=$2
	while [ "$CHILD_PID" -gt 1 ] 2>/dev/null; do
		[ "$CHILD_PID" = "$ANCESTOR_PID" ] && return 0
		CHILD_PID=$(ps -p "$CHILD_PID" -o ppid= | tr -d ' ')
		[ -n "$CHILD_PID" ] || return 1
	done
	return 1
}

# Stop the recorded Chrome and Wails processes without touching the isolated home.
stop_instance() {
	if [ -f "$CHROME_PID_FILE" ]; then
		CHROME_PID=$(cat "$CHROME_PID_FILE")
		if kill -0 "$CHROME_PID" 2>/dev/null; then
			kill -TERM "$CHROME_PID"
		fi
	fi

	if [ -f "$PID_FILE" ]; then
		PID=$(cat "$PID_FILE")
		if kill -0 "$PID" 2>/dev/null; then
			kill -TERM "$PID"
			ATTEMPTS=0
			while kill -0 "$PID" 2>/dev/null && [ "$ATTEMPTS" -lt 10 ]; do
				sleep 1
				ATTEMPTS=$((ATTEMPTS + 1))
			done
			if kill -0 "$PID" 2>/dev/null; then
				kill -KILL "$PID"
			fi
		fi
	fi

	if [ -f "$PORT_FILE" ]; then
		PORT=$(cat "$PORT_FILE")
		if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
			printf 'Warning: proxy port %s remains occupied after Wails cleanup. Inspect before the next run.\n' "$PORT" >&2
		fi
	fi
}
