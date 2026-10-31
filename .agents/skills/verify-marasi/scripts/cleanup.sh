#!/bin/sh
# Stops what launch.sh and electron.sh started, and only that: Chrome,
# Electron, the dev servers and the instance in the recorded throwaway config directory. Evidence stays.
set -eu
. "$(dirname -- "$0")/common.sh"

[ -f "$STATE_DIR/electron.pid" ] && "$SCRIPT_DIR/electron.sh" stop
stop_frontend
if [ -f "$CONFIG_DIR_FILE" ]; then
	CONFIG_DIR=$(config_dir)
	if [ -S "$CONFIG_DIR/instances/$INSTANCE.sock" ]; then
		"$MARASI" --config-dir "$CONFIG_DIR" --instance "$INSTANCE" service stop || printf 'Warning: %s in %s did not stop. Inspect it before the next run.\n' "$INSTANCE" "$CONFIG_DIR" >&2
	fi
	case $CONFIG_DIR in
		/tmp/mv2.*) rm -rf "$CONFIG_DIR" ;;
		*) printf 'Warning: left %s, which is not a verification config directory.\n' "$CONFIG_DIR" >&2 ;;
	esac
fi
rm -rf "$STATE_DIR"
printf 'Removed verification state: %s\nEvidence retained under: %s\n' "$STATE_DIR" "$EVIDENCE_ROOT"
