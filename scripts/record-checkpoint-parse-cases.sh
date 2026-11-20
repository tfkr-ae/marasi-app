#!/usr/bin/env bash
# Records frontend/src/lib/checkpoint/httpParse.cases.json from Marasi itself:
# what Checkpoint's rebuild says of each input in
# scripts/checkpoint-parse-cases/inputs.json, at the marasi version go.mod
# pins. Run it after bumping the pin; http_parse_cases_test.go fails until then.
#
# The recorder (scripts/checkpoint-parse-cases/record_test.go.txt) needs
# marasi's unexported Checkpoint code, so it runs as a test of package marasi
# in a writable copy of the pinned module.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

module_dir="$(GOWORK=off go list -m -f '{{.Dir}}' github.com/tfkr-ae/marasi)"
version="$(GOWORK=off go list -m -f '{{.Version}}' github.com/tfkr-ae/marasi)"
if [[ -z "$module_dir" || ! -d "$module_dir" ]]; then
  GOWORK=off go mod download github.com/tfkr-ae/marasi
  module_dir="$(GOWORK=off go list -m -f '{{.Dir}}' github.com/tfkr-ae/marasi)"
fi

work="$(mktemp -d)"
trap 'chmod -R u+w "$work" 2>/dev/null; rm -rf "$work"' EXIT

cp -R "$module_dir" "$work/marasi"
chmod -R u+w "$work/marasi"
cp scripts/checkpoint-parse-cases/record_test.go.txt "$work/marasi/zz_record_checkpoint_parse_cases_test.go"

out="$root/frontend/src/lib/checkpoint/httpParse.cases.json"
(
  cd "$work/marasi"
  CHECKPOINT_PARSE_INPUTS="$root/scripts/checkpoint-parse-cases/inputs.json" \
    CHECKPOINT_PARSE_OUTPUT="$out" \
    MARASI_VERSION="$version" \
    GOWORK=off go test -count=1 -run '^TestRecordCheckpointParseCases$' .
)
echo "recorded $out at marasi $version"
