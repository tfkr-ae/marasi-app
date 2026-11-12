//go:build linux && !android

package main

// defaultInstaller installs the Linux binary in place of the running one.
func defaultInstaller() platformInstaller {
	return binaryInstaller{assetName: "marasi-app"}
}
