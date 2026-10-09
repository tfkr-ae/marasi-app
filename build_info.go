package main

// Set at build time with -ldflags "-X main.buildChannel=... -X 'main.version=...'",
// using the same version format as the marasi CLI: the tag for releases,
// "DD.MM.YYYY (nightly <commit>)" for nightlies.
var (
	buildChannel = "dev"
	version      = "dev"
)

type BuildInfo struct {
	Channel string
	Version string
}

func (a *App) GetBuildInfo() BuildInfo {
	return BuildInfo{Channel: buildChannel, Version: version}
}
