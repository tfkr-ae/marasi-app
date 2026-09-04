#!/bin/sh

set -eu
. "$(dirname -- "$0")/common.sh"

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

rm -rf "$STATE_DIR"
printf 'Removed verification state: %s\nEvidence retained under: %s\n' "$STATE_DIR" "$EVIDENCE_ROOT"
