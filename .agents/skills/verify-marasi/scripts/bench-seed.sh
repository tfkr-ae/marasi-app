#!/bin/sh
# Fills the running instance's project with N requests (default 85000, about
# a 1 GB project) through its proxy: 40 apps x 7 versions x 300 resources,
# eight content types and 1.5-2.5 KB bodies, from bench-server.py on
# 127.0.0.1:18999. It takes about 15 minutes; Marasi indexes the bodies as
# they arrive.
set -eu
. "$(dirname -- "$0")/common.sh"

N=${1:-85000}
PROXY_PORT=$(instance_field proxy_listener | sed "s/.*://")
python3 "$SCRIPT_DIR/bench-server.py" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT INT TERM
sleep 1
seq 1 "$N" | awk '{
	split("application/json text/html text/javascript text/css image/png application/xml text/plain application/octet-stream", ct, " ")
	i = $1
	printf "http://127.0.0.1:18999/app%d/v%d/res%d/item-%d?ct=%s&size=%d\n", i % 40, i % 7, i % 300, i, ct[(i % 8) + 1], 1500 + (i % 1000)
}' | xargs -P 24 -I{} curl -s -o /dev/null -x "http://127.0.0.1:$PROXY_PORT" "{}"
printf 'seeded=%s\n' "$N"
