#!/usr/bin/env bash
# Records the Lua API of the Marasi version go.mod pins into
# frontend/src/lib/autocomplete/marasiLuaReference.json: the hooks, the
# libraries' functions and the types' methods, by name, as Marasi's
# extensions.Reference() lists them. definitions.test.js checks the editor's
# autocomplete (definitions.js, snippets.js) against it, and
# lua_reference_test.go fails when the pin moves without a new recording.
#
# Run it after bumping the marasi pin: scripts/record-lua-reference.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="$(GOWORK=off go list -m -f '{{.Version}}' github.com/tfkr-ae/marasi)"
dir="$(GOWORK=off go list -m -f '{{.Dir}}' github.com/tfkr-ae/marasi)"

work="$(mktemp -d)"
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT

# The module cache is read-only; copy the source so a program can sit in it.
cp -R "$dir/." "$work/marasi"
chmod -R u+w "$work/marasi"
mkdir -p "$work/marasi/cmd/record-lua-reference"
cat > "$work/marasi/cmd/record-lua-reference/main.go" <<'EOF'
package main

import (
	"encoding/json"
	"os"

	"github.com/tfkr-ae/marasi/extensions"
)

func names(entries []extensions.Entry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name)
	}
	return out
}

func main() {
	ref := extensions.Reference()
	libraries := map[string][]string{}
	for _, l := range ref.Libraries {
		libraries[l.Name] = names(l.Functions)
	}
	types := map[string][]string{}
	for _, t := range ref.Types {
		types[t.Name] = names(t.Methods)
	}
	out := map[string]any{
		"marasi":    os.Args[1],
		"hooks":     names(ref.Hooks),
		"globals":   names(ref.Globals),
		"libraries": libraries,
		"types":     types,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}
EOF

(cd "$work/marasi" && GOWORK=off GOFLAGS=-mod=mod go run ./cmd/record-lua-reference "$version") \
  > frontend/src/lib/autocomplete/marasiLuaReference.json
echo "recorded the Lua API of marasi $version"
