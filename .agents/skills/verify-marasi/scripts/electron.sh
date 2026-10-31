#!/bin/sh
# Runs Marasi v2 itself (Electron, through `npm run dev`) on the recorded
# instance's config directory with a DevTools port, for what only the app
# has: windows, menus and the updater. Its window connects to the recorded
# default instance at launch, as the app does.
#   electron.sh start   starts it, waits for Home, captures electron-ready.*
#   electron.sh stop    stops it (the instance keeps running)
set -eu
. "$(dirname -- "$0")/common.sh"

ELECTRON_PID_FILE=$STATE_DIR/electron.pid
ELECTRON_CDP_PORT_FILE=$STATE_DIR/electron-cdp-port
ELECTRON_DEV_PORT_FILE=$STATE_DIR/electron-dev-port

case ${1:-} in
	start)
		[ ! -f "$ELECTRON_PID_FILE" ] || {
			printf 'Electron PID %s is recorded. Run electron.sh stop first.\n' "$(cat "$ELECTRON_PID_FILE")" >&2
			exit 1
		}
		CONFIG_DIR=$(config_dir)
		EVIDENCE_DIR=$(evidence_dir)
		# Its own dev server, next to the browser's.
		DEV_PORT=$(free_port $(($(dev_port) + 1)))
		CDP_PORT=$(free_port 9300)
		printf '%s\n' "$DEV_PORT" > "$ELECTRON_DEV_PORT_FILE"
		printf '%s\n' "$CDP_PORT" > "$ELECTRON_CDP_PORT_FILE"
		# scripts/dev.mjs clears ELECTRON_RUN_AS_NODE for Electron.
		(cd "$REPO_ROOT" && MARASI_DEV_PORT="$DEV_PORT" exec node scripts/dev.mjs --remote-debugging-port="$CDP_PORT" --config-dir="$CONFIG_DIR") > "$EVIDENCE_DIR/electron.log" 2>&1 &
		printf '%s\n' "$!" > "$ELECTRON_PID_FILE"
		ATTEMPTS=0
		until curl --fail --silent "http://127.0.0.1:$CDP_PORT/json/list" 2>/dev/null | grep -q "localhost:$DEV_PORT"; do
			kill -0 "$(cat "$ELECTRON_PID_FILE")" 2>/dev/null || {
				printf 'Electron exited during startup. See %s/electron.log\n' "$EVIDENCE_DIR" >&2
				exit 1
			}
			ATTEMPTS=$((ATTEMPTS + 1))
			[ "$ATTEMPTS" -lt 120 ] || {
				printf 'Electron did not open its window within 120 s. See %s/electron.log\n' "$EVIDENCE_DIR" >&2
				exit 1
			}
			sleep 1
		done
		node "$SCRIPT_DIR/cdp.mjs" electron "$CDP_PORT" "http://localhost:$DEV_PORT/" "$EVIDENCE_DIR" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
		printf 'Marasi v2 (Electron) is connected to %s\ncdp=http://127.0.0.1:%s\napp_url=http://localhost:%s/\nEvidence: %s\n' "$INSTANCE" "$CDP_PORT" "$DEV_PORT" "$EVIDENCE_DIR"
		;;
	stop)
		# dev.mjs stops its dev server when Electron quits, and a TERM to
		# dev.mjs would leave both running, so quit Electron, its child, and
		# let dev.mjs exit on its own.
		if [ -f "$ELECTRON_PID_FILE" ]; then
			DEV_PID=$(cat "$ELECTRON_PID_FILE")
			for CHILD in $(pgrep -P "$DEV_PID" 2>/dev/null || true); do
				case $(ps -p "$CHILD" -o comm=) in
					*Electron* | *electron*) kill -TERM "$CHILD" 2>/dev/null || true ;;
				esac
			done
			ATTEMPTS=0
			while kill -0 "$DEV_PID" 2>/dev/null && [ "$ATTEMPTS" -lt 15 ]; do
				sleep 1
				ATTEMPTS=$((ATTEMPTS + 1))
			done
			if kill -0 "$DEV_PID" 2>/dev/null; then
				printf 'Warning: dev.mjs PID %s did not exit after Electron quit. Inspect it and its dev server.\n' "$DEV_PID" >&2
			fi
		fi
		rm -f "$ELECTRON_PID_FILE" "$ELECTRON_CDP_PORT_FILE" "$ELECTRON_DEV_PORT_FILE"
		printf 'Electron stopped; %s keeps running\n' "$INSTANCE"
		;;
	*)
		printf 'Usage: %s {start|stop}\n' "$0" >&2
		exit 2
		;;
esac
