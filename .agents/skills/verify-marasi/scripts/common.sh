#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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
APP_CONFIG_DIR="$HOME_DIR/Library/Application Support/Marasi"
APP_BIN=$REPO_ROOT/build/bin/marasi-app.app/Contents/MacOS/marasi-app

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
