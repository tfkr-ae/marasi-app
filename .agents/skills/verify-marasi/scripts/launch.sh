#!/bin/sh
# Starts a throwaway Marasi instance, the frontend's dev server on it, and
# an isolated headless Chrome, then connects through the connection screen.
set -eu
. "$(dirname -- "$0")/common.sh"

require_tools lsof curl node

[ -x "$MARASI" ] || {
	printf 'No Marasi at %s. Run `npm run marasi`, or set MARASI_BIN.\n' "$MARASI" >&2
	exit 1
}
[ -d "$REPO_ROOT/frontend/node_modules/vite" ] || {
	printf 'The frontend has no packages. Run scripts/bootstrap.sh.\n' >&2
	exit 1
}
if [ -e "$STATE_DIR" ]; then
	printf 'Verification state exists at %s. Run doctor.sh, or cleanup.sh before launching again.\n' "$STATE_DIR" >&2
	exit 1
fi

mkdir -p "$STATE_DIR" "$EVIDENCE_ROOT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP
mkdir "$EVIDENCE_DIR"
printf '%s\n' "$EVIDENCE_DIR" > "$EVIDENCE_FILE"

# A short path: the instance's socket must stay under 104 bytes, which a
# macOS $TMPDIR path can exceed.
CONFIG_DIR=$(mktemp -d /tmp/mv2.XXXXXX)
printf '%s\n' "$CONFIG_DIR" > "$CONFIG_DIR_FILE"
# The app config the dev server serves: past the first-run setup, which
# would cover Home.
cat > "$CONFIG_DIR/marasi_appconfig.yaml" <<EOF
first_run: false
EOF
"$MARASI" --config-dir "$CONFIG_DIR" --instance "$INSTANCE" --json service start --port 0 --control-address 127.0.0.1:0 > "$INSTANCE_FILE" 2> "$EVIDENCE_DIR/marasi-start.log" || {
	printf 'Marasi did not start. See %s/marasi-start.log and %s\n' "$EVIDENCE_DIR" "$INSTANCE_FILE" >&2
	exit 1
}
{
	printf 'started_at=%s\n' "$STAMP"
	printf 'marasi=%s\n' "$MARASI"
	printf 'config_dir=%s\n' "$CONFIG_DIR"
	printf 'instance=%s\n' "$INSTANCE"
	printf 'proxy_listener=%s\n' "$(instance_field proxy_listener)"
	printf 'control_listener=%s\n' "$(instance_field control_listener)"
	printf 'viewport=%sx%s\n' "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
} > "$EVIDENCE_DIR/launch.txt"
"$MARASI" --config-dir "$CONFIG_DIR" --instance "$INSTANCE" --json service status > "$EVIDENCE_DIR/instance-status.json"

start_frontend "$EVIDENCE_DIR"
printf 'ready=true\n' >> "$EVIDENCE_DIR/launch.txt"
printf 'Marasi v2 is connected to %s at %s (proxy %s)\nEvidence: %s\n' "$INSTANCE" "$(app_url)" "$(instance_field proxy_listener)" "$EVIDENCE_DIR"
