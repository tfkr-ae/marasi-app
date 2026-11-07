package main

import (
	"regexp"
	"runtime/debug"
)

// The Marasi module the app pins in go.mod. Its version, as Go records it
// in the binary at build time, is the oldest service the app supports
// (decisions ruling 4).
const marasiModule = "github.com/tfkr-ae/marasi"

// readBuildInfo returns the module versions built into the binary. Tests
// replace it.
var readBuildInfo = debug.ReadBuildInfo

// A pseudo-version's commit time and hash: v0.0.0-20261030061243-5363500e1dd8,
// or after a tag, v1.2.4-0.20261105093000-abcdefabcdef.
var pseudoVersionTime = regexp.MustCompile(`[-.](\d{4})(\d{2})(\d{2})\d{6}-[0-9a-f]{12}$`)

// A Marasi release tag, DD.MM.YYYY with an optional same-day -N, as Go
// records it (v30.10.2026, v23.06.2026-2, v30.10.2026+incompatible) or raw.
var releaseTagDate = regexp.MustCompile(`^v?(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(\d{4})(?:-\d+)?(?:\+incompatible)?$`)

// marasiVersionDate returns the date of a Marasi module version as
// DD.MM.YYYY, the format of Marasi's version dates: a pseudo-version's
// commit date or a release tag's date. It is "" when the version has none.
func marasiVersionDate(version string) string {
	if m := pseudoVersionTime.FindStringSubmatch(version); m != nil {
		return m[3] + "." + m[2] + "." + m[1]
	}
	if m := releaseTagDate.FindStringSubmatch(version); m != nil {
		return m[1] + "." + m[2] + "." + m[3]
	}
	return ""
}

// MarasiPin returns the date (DD.MM.YYYY) of the Marasi version the app was
// built against, or "" when the build doesn't record one. A service older
// than it gets the version warning.
func (a *App) MarasiPin() string {
	info, ok := readBuildInfo()
	if !ok || info == nil {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path == marasiModule {
			return marasiVersionDate(dep.Version)
		}
	}
	return ""
}
