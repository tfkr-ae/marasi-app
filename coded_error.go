package main

import (
	"fmt"
	"strings"
)

// Codes the frontend reads from a refused call. Wails passes on only the
// error text, so an error the frontend acts on carries one of these
// (codedError), and frontend/src/lib/errorCodes.js's codeIDs reads it.
const (
	// codeCLIMissing: there is no Marasi CLI at the custom path or on PATH,
	// so the frontend offers to install one.
	codeCLIMissing = "cli_missing"
	// codeInstanceFailed: the CLI ran but couldn't start, attach to or read
	// the local instance.
	codeInstanceFailed = "instance_failed"
	// codeChromeLaunchFailed: the Chrome launcher couldn't start Chrome,
	// such as when no Chrome executable is found; the frontend shows why.
	codeChromeLaunchFailed = "chrome_launch_failed"
)

// codedError wraps err with what, code and the ids the refusal names:
// "<what>: <code> (<id>, <id>): <err>". The frontend's codeIDs reads it.
func codedError(what, code string, ids []string, err error) error {
	return fmt.Errorf("%s: %s (%s): %w", what, code, strings.Join(ids, ", "), err)
}
