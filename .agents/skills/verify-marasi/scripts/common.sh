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
# The server build binds this loopback address. Chrome opens the same
# literal, which the server's Host check accepts.
SERVER_HOST=127.0.0.1
PID_FILE=$STATE_DIR/app.pid
PORT_FILE=$STATE_DIR/proxy-port
SERVER_PORT_FILE=$STATE_DIR/server-port
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
# The real Marasi service the app reaches: an isolated config dir (never the
# researcher's own), the CLI linked as $CLI_DIR/marasi (put first on the
# app's PATH, so the app finds it there), its control password and PID, and
# who started it: launch ("attach", the default) or the app ("app").
SERVICE_DIR=$STATE_DIR/marasi
CLI_DIR=$STATE_DIR/bin
CLI_BIN=$CLI_DIR/marasi
SERVICE_PID_FILE=$STATE_DIR/service.pid
SERVICE_PASSWORD_FILE=$STATE_DIR/service-password
CONTROL_URL_FILE=$STATE_DIR/control-url
SERVICE_MODE_FILE=$STATE_DIR/service-mode
SERVICE_PROJECT=$SERVICE_DIR/projects/scratchpad.marasi
# build.sh writes the server build here. Launch runs a copy in the state
# directory, so a rebuild for another session never replaces a running binary.
BUILD_BIN=$REPO_ROOT/bin/marasi-app-server
APP_BIN=$STATE_DIR/marasi-app-server

# Fail fast when a helper's tool is missing. Without lsof every port check
# reads as free and launch only fails after the app has started.
require_tools() {
	for TOOL in "$@"; do
		command -v "$TOOL" >/dev/null 2>&1 || {
			printf 'Required tool %s is not on PATH.' "$TOOL" >&2
			case $TOOL in
				wails3) printf ' It is usually in %s/bin; scripts/bootstrap.sh installs it.' "$(go env GOPATH 2>/dev/null)" >&2 ;;
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

recorded_server_port() {
	[ -f "$SERVER_PORT_FILE" ] || {
		printf 'No server port at %s\n' "$SERVER_PORT_FILE" >&2
		exit 1
	}
	cat "$SERVER_PORT_FILE"
}

app_url() {
	printf 'http://%s:%s' "$SERVER_HOST" "$(recorded_server_port)"
}

evidence_dir() {
	[ -f "$EVIDENCE_FILE" ] || {
		printf 'No evidence directory recorded at %s\n' "$EVIDENCE_FILE" >&2
		exit 1
	}
	cat "$EVIDENCE_FILE"
}

port_busy() {
	lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# A port nothing listens on, from the OS. Each session gets its own, so
# parallel sessions never share one.
free_port() {
	node -e 'const s = require("node:net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });'
}

# The build launch would run: present, built with -tags server, and newer
# than every Go and frontend source file. Prints the reason and fails
# otherwise.
check_build() {
	[ -x "$BUILD_BIN" ] || {
		printf 'No server build at %s. Run %s/build.sh.\n' "$BUILD_BIN" "$SCRIPT_DIR" >&2
		return 1
	}
	TAGS=$(go version -m "$BUILD_BIN" 2>/dev/null | sed -n 's/^[[:space:]]*build[[:space:]]*-tags=//p')
	case ",$TAGS," in
		*,server,*) ;;
		*)
			printf '%s was not built with -tags server (tags: %s). Run %s/build.sh.\n' "$BUILD_BIN" "${TAGS:-none}" "$SCRIPT_DIR" >&2
			return 1
			;;
	esac
	NEWER=$(cd "$REPO_ROOT" && find . -maxdepth 1 \( -name '*.go' ! -name '*_test.go' -o -name go.mod -o -name go.sum \) -newer "$BUILD_BIN" -print | head -n 1)
	[ -n "$NEWER" ] || NEWER=$(cd "$REPO_ROOT" && find frontend/src frontend/static -path frontend/src/lib/bindings -prune -o -type f -newer "$BUILD_BIN" -print 2>/dev/null | head -n 1)
	[ -z "$NEWER" ] || {
		printf '%s is older than %s. Run %s/build.sh.\n' "$BUILD_BIN" "$NEWER" "$SCRIPT_DIR" >&2
		return 1
	}
}

# Checks launch needs before it starts anything: tools, the build, and free
# ports. Doctor runs the same checks when no instance is recorded.
preflight() {
	require_tools lsof curl node go
	check_build
	for NAMED_PORT in "$@"; do
		NAME=${NAMED_PORT%%=*}
		VALUE=${NAMED_PORT#*=}
		[ -n "$VALUE" ] && [ "$VALUE" != 0 ] || continue
		if port_busy "$VALUE"; then
			printf '%s port %s is already in use by %s. Choose another port or stop that process.\n' "$NAME" "$VALUE" "$(lsof -nP -iTCP:"$VALUE" -sTCP:LISTEN | awk 'NR == 2 { print $1 " PID " $2 }')" >&2
			return 1
		fi
	done
}

# Runs the linked CLI against the isolated instance, never another one.
marasi_cli() {
	env -u MARASI_PASSWORD -u MARASI_INSTANCE -u MARASI_CONFIG_DIR -u MARASI_REMOTE \
		"$CLI_BIN" --config-dir "$SERVICE_DIR" --instance default "$@"
}

# The CLI launch links: MARASI_VERIFY_CLI, else marasi on PATH. It must be
# new enough to take a control password (MARASI_PASSWORD), which older dev
# builds lack.
resolve_cli() {
	CLI_SOURCE=${MARASI_VERIFY_CLI:-$(command -v marasi 2>/dev/null || true)}
	[ -n "$CLI_SOURCE" ] && [ -x "$CLI_SOURCE" ] || {
		printf 'No Marasi CLI. Put marasi on PATH or set MARASI_VERIFY_CLI to a CLI built from Marasi main.\n' >&2
		return 1
	}
	"$CLI_SOURCE" service start --help 2>&1 | grep -q MARASI_PASSWORD || {
		printf '%s predates control passwords. Set MARASI_VERIFY_CLI to a CLI built from Marasi main.\n' "$CLI_SOURCE" >&2
		return 1
	}
	# The instance's socket path must fit in 104 bytes.
	SOCKET=$SERVICE_DIR/instances/default.sock
	[ "${#SOCKET}" -lt 104 ] || {
		printf 'The service socket path %s is too long; use a shorter MARASI_VERIFY_STATE_DIR.\n' "$SOCKET" >&2
		return 1
	}
}

# A JSON field from stdin, such as `json_field proxy_listener`.
json_field() {
	node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];console.log(v==null?"":v)})' "$1"
}

# Stops the isolated service instance, if any. `service stop` succeeds when
# it isn't running too.
stop_service() {
	[ -x "$CLI_BIN" ] && [ -d "$SERVICE_DIR" ] || return 0
	marasi_cli service stop --json >/dev/null 2>&1 || true
}

# Whether the isolated instance answers its socket: "running" or "stopped".
service_state() {
	if [ -x "$CLI_BIN" ] && marasi_cli service status --json >/dev/null 2>&1; then
		printf 'running\n'
	else
		printf 'stopped\n'
	fi
}

# Stop the recorded Chrome and Marasi processes without touching the isolated home.
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

	# The app stops an instance it started when it quits, and leaves one it
	# attached to running. Record which, then stop the instance either way.
	if [ -x "$CLI_BIN" ] && [ -d "$SERVICE_DIR" ]; then
		AFTER_QUIT=$(service_state)
		if [ -f "$EVIDENCE_FILE" ] && [ -d "$(cat "$EVIDENCE_FILE")" ]; then
			printf 'service_mode=%s\nservice_after_app_quit=%s\n' "$(cat "$SERVICE_MODE_FILE" 2>/dev/null || printf unknown)" "$AFTER_QUIT" > "$(cat "$EVIDENCE_FILE")/service-after-quit.txt"
		fi
		printf 'Service after the app quit: %s\n' "$AFTER_QUIT"
		stop_service
	fi

	for RECORDED in "$PORT_FILE" "$SERVER_PORT_FILE"; do
		[ -f "$RECORDED" ] || continue
		RECORDED_PORT=$(cat "$RECORDED")
		if port_busy "$RECORDED_PORT"; then
			printf 'Warning: port %s remains occupied after Marasi stopped. Inspect before the next run.\n' "$RECORDED_PORT" >&2
		fi
	done
}
