#!/bin/sh
# Restarts the dev server and Chrome on the same instance, as a fresh page
# load would, and connects again. The instance, its project and the
# browser's light or dark choice stay. Evidence goes to a new directory.
set -eu
. "$(dirname -- "$0")/common.sh"

config_dir >/dev/null
# The bridge forgets its connection with the dev server, so the page
# connects again through the connection screen.
CHROME_PROFILE=$STATE_DIR/chrome-kept
stop_frontend
rm -rf "$CHROME_PROFILE"
[ -d "$STATE_DIR/chrome" ] && mv "$STATE_DIR/chrome" "$CHROME_PROFILE"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR=$EVIDENCE_ROOT/$STAMP
mkdir "$EVIDENCE_DIR"
printf '%s\n' "$EVIDENCE_DIR" > "$EVIDENCE_FILE"
printf 'restarted_at=%s\nconfig_dir=%s\ninstance=%s\n' "$STAMP" "$(config_dir)" "$INSTANCE" > "$EVIDENCE_DIR/launch.txt"
KEEP_CHROME_PROFILE=$CHROME_PROFILE start_frontend "$EVIDENCE_DIR"
printf 'ready=true\n' >> "$EVIDENCE_DIR/launch.txt"
printf 'Marasi v2 reconnected to %s at %s\nEvidence: %s\n' "$INSTANCE" "$(app_url)" "$EVIDENCE_DIR"
