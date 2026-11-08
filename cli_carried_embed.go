//go:build carried_cli && ((darwin && arm64) || (linux && amd64) || (windows && amd64))

package main

import _ "embed"

// CI writes carried_cli/ with cmd/carry-cli before it builds with the
// carried_cli tag; without those files the build fails. Only the platforms
// Marasi publishes a CLI for carry one, so the amd64 half of a universal
// macOS build carries none.

//go:embed carried_cli/marasi.gz
var carriedCLIGzipped []byte

//go:embed carried_cli/carried.json
var carriedCLIRecord []byte
