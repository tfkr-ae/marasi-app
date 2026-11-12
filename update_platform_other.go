//go:build (!linux && !darwin && !windows) || ios || android

package main

// defaultInstaller is nil: Marasi App ships no build for this platform to
// update to (the iOS and Android apps update through their stores), so the
// panel offers only the release page.
func defaultInstaller() platformInstaller {
	return nil
}
