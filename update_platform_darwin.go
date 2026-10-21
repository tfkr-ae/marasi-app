package main

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"

	"golang.org/x/sys/unix"
)

// defaultInstaller replaces the running Marasi.app with the one in
// marasi-app.app.zip, once codesign confirms it is signed by the same Apple
// developer team. A translocated Marasi.app is replaced where it was opened
// from.
func defaultInstaller() platformInstaller {
	return bundleInstaller{assetName: "marasi-app.app.zip", teamOf: codesignTeam, original: translocationOriginal}
}

// codesignTeam is the Apple developer team the bundle is signed by, read
// with codesign once codesign has checked the signature is intact. It is ""
// for an unsigned or ad-hoc signed bundle, whose signature is not checked:
// the Go linker ad-hoc signs binaries in a way strict verification rejects,
// and a bundle with no team is refused either way.
func codesignTeam(bundle string) (string, error) {
	// codesign -d writes what it displays to stderr.
	out, err := exec.Command("/usr/bin/codesign", "-dv", "--verbose=4", bundle).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "not signed at all") {
			return "", nil
		}
		return "", fmt.Errorf("reading the code signature: %w: %s", err, bytes.TrimSpace(out))
	}
	team := parseTeamIdentifier(string(out))
	if team == "" {
		return "", nil
	}
	if out, err := exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", bundle).CombinedOutput(); err != nil {
		return "", fmt.Errorf("the code signature is not valid: %s", bytes.TrimSpace(out))
	}
	return team, nil
}

// parseTeamIdentifier finds the TeamIdentifier line in codesign -dv output;
// "not set" (ad-hoc signing) is no team.
func parseTeamIdentifier(display string) string {
	for _, line := range strings.Split(display, "\n") {
		if team, ok := strings.CutPrefix(strings.TrimSpace(line), "TeamIdentifier="); ok && team != "not set" {
			return team
		}
	}
	return ""
}

// exchangePaths swaps the two bundles atomically (rename with RENAME_SWAP),
// so the install location always holds a whole app.
func exchangePaths(staged, location string) error {
	return unix.RenamexNp(staged, location, unix.RENAME_SWAP)
}

// openBundle launches the bundle as a new instance (open -n), since the app
// it replaces is still shutting down and would otherwise just be brought to
// the front.
func openBundle(location string) error {
	if out, err := exec.Command("/usr/bin/open", "-n", location).CombinedOutput(); err != nil {
		return fmt.Errorf("open %s: %w: %s", location, err, bytes.TrimSpace(out))
	}
	return nil
}
