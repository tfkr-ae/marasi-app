package main

import (
	"os"
	"runtime/debug"
	"strings"
	"testing"
)

func withBuildInfo(t *testing.T, info *debug.BuildInfo) {
	t.Helper()
	previous := readBuildInfo
	readBuildInfo = func() (*debug.BuildInfo, bool) { return info, info != nil }
	t.Cleanup(func() { readBuildInfo = previous })
}

func TestMarasiPinIsTheDateOfThePinnedPseudoVersion(t *testing.T) {
	withBuildInfo(t, &debug.BuildInfo{Deps: []*debug.Module{
		{Path: "golang.org/x/mod", Version: "v0.20.0"},
		{Path: "github.com/tfkr-ae/marasi", Version: "v0.0.0-20261030061243-5363500e1dd8"},
	}})

	if got := (&App{}).MarasiPin(); got != "30.10.2026" {
		t.Fatalf("MarasiPin() = %q, want 30.10.2026", got)
	}
}

func TestMarasiPinReadsPseudoVersionsAfterATag(t *testing.T) {
	for _, version := range []string{
		"v1.2.4-0.20261105093000-abcdefabcdef",
		"v1.3.0-rc.1.0.20261105093000-abcdefabcdef",
	} {
		withBuildInfo(t, &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/tfkr-ae/marasi", Version: version}}})
		if got := (&App{}).MarasiPin(); got != "05.11.2026" {
			t.Errorf("MarasiPin() for %s = %q, want 05.11.2026", version, got)
		}
	}
}

func TestMarasiPinIsEmptyWithoutADate(t *testing.T) {
	cases := map[string]*debug.BuildInfo{
		"no build info":   nil,
		"no marasi":       {Deps: []*debug.Module{{Path: "golang.org/x/mod", Version: "v0.20.0"}}},
		"a plain tag":     {Deps: []*debug.Module{{Path: "github.com/tfkr-ae/marasi", Version: "v1.2.3"}}},
		"a local replace": {Deps: []*debug.Module{{Path: "github.com/tfkr-ae/marasi", Version: "(devel)"}}},
	}
	for name, info := range cases {
		withBuildInfo(t, info)
		if got := (&App{}).MarasiPin(); got != "" {
			t.Errorf("%s: MarasiPin() = %q, want empty", name, got)
		}
	}
}

// The test binary records go.mod's pin the way the app's build does.
func TestMarasiPinFollowsGoMod(t *testing.T) {
	data, err := os.ReadFile("go.mod")
	if err != nil {
		t.Fatal(err)
	}
	var pinned string
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "github.com/tfkr-ae/marasi" {
			pinned = fields[1]
		}
	}
	if pinned == "" {
		t.Fatal("go.mod pins no github.com/tfkr-ae/marasi")
	}
	want := pseudoVersionDate(pinned)
	if want == "" {
		t.Skipf("go.mod pins %s, which carries no date", pinned)
	}
	if got := (&App{}).MarasiPin(); got != want {
		t.Fatalf("MarasiPin() = %q, want %q from go.mod's %s", got, want, pinned)
	}
}
