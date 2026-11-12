//go:build (unix && !darwin) || ios

package main

import (
	"errors"
	"fmt"
	"os"
)

// exchangePaths swaps two directories outside macOS (and on iOS), where bundleInstaller
// only runs in tests: location is renamed aside, staged moved into its
// place, and location restored if that fails.
func exchangePaths(staged, location string) error {
	aside := staged + ".old"
	if err := os.Rename(location, aside); err != nil {
		return err
	}
	if err := os.Rename(staged, location); err != nil {
		if restoreErr := os.Rename(aside, location); restoreErr != nil {
			return fmt.Errorf("%w (and restoring %s: %v)", err, location, restoreErr)
		}
		return err
	}
	return os.Rename(aside, staged)
}

// openBundle is unsupported outside macOS.
func openBundle(string) error {
	return errors.New("app bundles only open on macOS")
}
