package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"aead.dev/minisign"
)

// Installing and updating the Marasi CLI from a fake Marasi release server,
// signed with a key made for the test and injected through cliRuntime.key.
// The release server is never GitHub.

var (
	cliBinaryOld = []byte("#!/bin/sh\necho marasi 30.10.2026\n")
	cliBinaryNew = []byte("#!/bin/sh\necho marasi 06.11.2026\n")
)

// cliRelease is one Marasi release on the fake server.
type cliRelease struct {
	tag, name string
	channel   string // in the trusted comment
	version   string // in the trusted comment
	assets    map[string][]byte
	// checksums and signature replace the honest ones when set; noSignature
	// leaves the signature out.
	checksums   []byte
	signature   []byte
	noSignature bool
}

func cliChecksums(assets map[string][]byte) []byte {
	names := make([]string, 0, len(assets))
	for name := range assets {
		names = append(names, name)
	}
	slices.Sort(names)
	var out bytes.Buffer
	for _, name := range names {
		fmt.Fprintf(&out, "%x  %s\n", sha256.Sum256(assets[name]), name)
	}
	return out.Bytes()
}

// publishCLI publishes r on releases, signed with keys unless r overrides.
func publishCLI(releases *fakeReleaseServer, keys signingKeys, r cliRelease) {
	releases.publish(fakeRelease{Tag: r.tag, Name: r.name, Prerelease: r.tag == "nightly"})
	for name, data := range r.assets {
		releases.addAsset(r.tag, name, data)
	}
	checksums := r.checksums
	if checksums == nil {
		checksums = cliChecksums(r.assets)
	}
	releases.addAsset(r.tag, checksumsAsset, checksums)
	if r.noSignature {
		return
	}
	signature := r.signature
	if signature == nil {
		signature = minisign.SignWithComments(keys.private, checksums, "marasi "+r.channel+" "+r.version, "signature from minisign secret key")
	}
	releases.addAsset(r.tag, signatureAsset, signature)
}

func releaseCLI(tag string, assets map[string][]byte) cliRelease {
	return cliRelease{tag: tag, name: tag, channel: "release", version: tag, assets: assets}
}

func nightlyCLI(version string, assets map[string][]byte) cliRelease {
	return cliRelease{tag: "nightly", name: version, channel: "nightly", version: version, assets: assets}
}

// cliInstall is a test's view of an App installing CLIs on goos/goarch.
type cliInstall struct {
	app      *App
	releases *fakeReleaseServer
	keys     signingKeys
	probes   *cliProbes
	chmods   map[string]os.FileMode
	builds   map[string]cliBuild // by path; installed files read as their binary's version
	events   *recordedEvents
}

// newCLIInstall returns an App on goos/goarch with no CLI, reading Marasi
// releases from a fake server and trusting a test key. Any file it
// installs answers like Marasi and reads as the version its bytes echo.
func newCLIInstall(t *testing.T, goos, goarch string) *cliInstall {
	t.Helper()
	c := &cliInstall{
		releases: newFakeReleaseServer(t),
		keys:     newSigningKeys(t),
		probes:   &cliProbes{answers: map[string]cliAnswer{}},
		chmods:   map[string]os.FileMode{},
		builds:   map[string]cliBuild{},
		events:   &recordedEvents{},
	}
	c.app = cliTestApp(t, c.probes, "")
	c.app.emitEvent = c.events.emit
	c.app.runCLI = func(ctx context.Context, path string, args, env []string) ([]byte, int, error) {
		if _, err := os.Stat(path); err == nil {
			c.probes.answers[path] = cliAnswer{exit: 1, stdout: notRunning}
		}
		return c.probes.run(ctx, path, args, env)
	}
	c.app.cliRuntime.readBuild = func(path string) (cliBuild, error) {
		if build, ok := c.builds[path]; ok {
			return build, nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return cliBuild{}, err
		}
		switch {
		case bytes.Equal(data, cliBinaryOld):
			return cliBuild{Version: "30.10.2026", Channel: "release"}, nil
		case bytes.Equal(data, cliBinaryNew):
			return cliBuild{Version: "06.11.2026", Channel: "release"}, nil
		}
		return cliBuild{Version: "dev"}, nil
	}
	r := &c.app.cliRuntime
	r.goos, r.goarch = goos, goarch
	r.releaseSource = c.releases.URL()
	r.key = c.keys.public
	r.download = c.app.downloadURL
	r.tempDir = func() (string, error) { return os.MkdirTemp(t.TempDir(), "download-") }
	r.writeFile = writeNewFile
	r.chmod = func(path string, mode os.FileMode) error {
		c.chmods[path] = mode
		return os.Chmod(path, mode)
	}
	r.rename = os.Rename
	r.remove = os.RemoveAll
	r.mkdirAll = func(path string) error { return os.MkdirAll(path, 0o755) }
	r.homeDir = func() (string, error) { return "/home/researcher", nil }
	r.getenv = func(string) string { return "" }
	// Whatever the build carries, these tests install from releases.
	r.carried = nil
	c.app.updateClient = c.releases.server.Client()
	c.app.build = BuildInfo{Channel: "release", Version: "30.10.2026"}
	if err := c.app.Config.setCLIChannel(""); err != nil {
		t.Fatal(err)
	}
	return c
}

// dirFiles lists the names in dir; none when it doesn't exist.
func dirFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

func TestInstallCLIInstallsTheReleaseAssetForThisPlatform(t *testing.T) {
	for _, platform := range []struct {
		goos, goarch, asset, file string
		executable                bool
	}{
		{"darwin", "arm64", "marasi-darwin-arm64", "marasi", true},
		{"linux", "amd64", "marasi-linux-amd64", "marasi", true},
		{"windows", "amd64", "marasi-windows-amd64.exe", "marasi.exe", false},
	} {
		t.Run(platform.goos+"/"+platform.goarch, func(t *testing.T) {
			c := newCLIInstall(t, platform.goos, platform.goarch)
			// Every platform's build is published, each different, so the
			// installed bytes show which asset was picked.
			assets := map[string][]byte{
				"marasi-darwin-arm64":      []byte("darwin build"),
				"marasi-linux-amd64":       []byte("linux build"),
				"marasi-windows-amd64.exe": []byte("windows build"),
			}
			publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", assets))
			dir := filepath.Join(t.TempDir(), "bin")

			result, err := c.app.InstallCLI(dir)
			if err != nil {
				t.Fatal(err)
			}

			if result.Outcome != "installed" {
				t.Fatalf("outcome = %+v, want installed", result)
			}
			installed := filepath.Join(dir, platform.file)
			data, err := os.ReadFile(installed)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(data, assets[platform.asset]) {
				t.Fatalf("installed %q, want %s", data, platform.asset)
			}
			if got := dirFiles(t, dir); !slices.Equal(got, []string{platform.file}) {
				t.Fatalf("folder holds %v, want only %s", got, platform.file)
			}
			info, err := os.Stat(installed)
			if err != nil {
				t.Fatal(err)
			}
			if platform.executable && info.Mode()&0o111 == 0 {
				t.Fatalf("mode of %s = %v, want it executable", installed, info.Mode())
			}
			if !platform.executable && len(c.chmods) != 0 {
				t.Fatalf("chmod %v on Windows, want none", c.chmods)
			}
			if saved := c.app.Config.cliPath(); saved.Path != installed || saved.Source != "installed" {
				t.Fatalf("app config holds %+v, want the installed path", saved)
			}
			if !result.CLI.Found || result.CLI.Path != installed || result.CLI.Source != "installed" {
				t.Fatalf("CLI = %+v, want the installed CLI", result.CLI)
			}
		})
	}
}

func TestInstallCLIOnAPlatformWithNoBuildSaysSoAndDownloadsNothing(t *testing.T) {
	c := newCLIInstall(t, "darwin", "amd64")
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-darwin-arm64": cliBinaryNew}))
	dir := t.TempDir()

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure.Kind != "no-build" || result.Failure.Reason != "No Marasi CLI build for this platform" {
		t.Fatalf("result = %+v, want no build for this platform", result)
	}
	if c.releases.requestCount() != 0 {
		t.Fatalf("requested %v, want nothing", c.releases.requested())
	}
	if got := dirFiles(t, dir); len(got) != 0 {
		t.Fatalf("folder holds %v, want nothing", got)
	}
}

func TestInstallCLIWritesNothingWhenVerificationFails(t *testing.T) {
	asset := "marasi-linux-amd64"
	honest := cliChecksums(map[string][]byte{asset: cliBinaryNew})
	other := newSigningKeys(t)
	for name, tc := range map[string]struct {
		release func(keys signingKeys) cliRelease
		kind    string
	}{
		"tampered checksums": {
			// The attacker swaps the build and its checksum; the signature
			// still covers the honest checksums.
			release: func(keys signingKeys) cliRelease {
				r := releaseCLI("06.11.2026", map[string][]byte{asset: []byte("evil")})
				r.checksums = cliChecksums(r.assets)
				r.signature = minisign.SignWithComments(keys.private, honest, "marasi release 06.11.2026", "")
				return r
			},
			kind: "signature",
		},
		"signed by another key": {
			release: func(signingKeys) cliRelease {
				r := releaseCLI("06.11.2026", map[string][]byte{asset: cliBinaryNew})
				r.signature = minisign.SignWithComments(other.private, honest, "marasi release 06.11.2026", "")
				return r
			},
			kind: "signature",
		},
		"unsigned release": {
			release: func(signingKeys) cliRelease {
				r := releaseCLI("06.11.2026", map[string][]byte{asset: cliBinaryNew})
				r.noSignature = true
				return r
			},
			kind: "signature",
		},
		"another program's signed checksums": {
			// The same key signs marasi-app releases.
			release: func(keys signingKeys) cliRelease {
				r := releaseCLI("06.11.2026", map[string][]byte{asset: cliBinaryNew})
				r.signature = minisign.SignWithComments(keys.private, honest, "marasi-app release 06.11.2026", "")
				return r
			},
			kind: "signature",
		},
		"another channel's signed checksums": {
			release: func(keys signingKeys) cliRelease {
				r := releaseCLI("06.11.2026", map[string][]byte{asset: cliBinaryNew})
				r.signature = minisign.SignWithComments(keys.private, honest, "marasi nightly 06.11.2026 (nightly 7d411bd)", "")
				return r
			},
			kind: "signature",
		},
		"binary that doesn't match its checksum": {
			release: func(signingKeys) cliRelease {
				r := releaseCLI("06.11.2026", map[string][]byte{asset: []byte("corrupted")})
				r.checksums = honest
				return r
			},
			kind: "checksum",
		},
	} {
		t.Run(name, func(t *testing.T) {
			c := newCLIInstall(t, "linux", "amd64")
			publishCLI(c.releases, c.keys, tc.release(c.keys))
			dir := filepath.Join(t.TempDir(), "bin")

			result, err := c.app.InstallCLI(dir)
			if err != nil {
				t.Fatal(err)
			}

			if result.Outcome != "failed" || result.Failure == nil || result.Failure.Kind != tc.kind {
				t.Fatalf("result = %+v, want a %s failure", result, tc.kind)
			}
			if got := dirFiles(t, dir); len(got) != 0 {
				t.Fatalf("folder holds %v, want nothing written", got)
			}
			if len(c.chmods) != 0 {
				t.Fatalf("chmod %v, want none", c.chmods)
			}
			if saved := c.app.Config.cliPath(); saved.Path != "" {
				t.Fatalf("app config holds %+v, want nothing saved", saved)
			}
		})
	}
}

func TestInstallCLIInstallsNothingWhenItCantMakeTheBuildExecutable(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))
	c.app.cliRuntime.chmod = func(string, os.FileMode) error { return errors.New("operation not permitted") }
	dir := filepath.Join(t.TempDir(), "bin")

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure == nil || result.Failure.Kind != string(UpdateFailureInstall) {
		t.Fatalf("result = %+v, want an install failure", result)
	}
	if got := dirFiles(t, dir); len(got) != 0 {
		t.Fatalf("folder holds %v, want nothing installed", got)
	}
	if saved := c.app.Config.cliPath(); saved.Path != "" {
		t.Fatalf("app config holds %+v, want nothing saved", saved)
	}
}

func TestInstallCLIFromAMissingNightlySaysToTryAgainAndWritesNothing(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	if _, err := c.app.SetCLIChannel("nightly"); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure.Reason != "Nightly release unavailable, try again shortly" {
		t.Fatalf("result = %+v, want the nightly unavailable", result)
	}
	if got := dirFiles(t, dir); len(got) != 0 {
		t.Fatalf("folder holds %v, want nothing", got)
	}
}

func TestInstallCLIFromANightlyWithoutThisPlatformsAssetSaysToTryAgain(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	if _, err := c.app.SetCLIChannel("nightly"); err != nil {
		t.Fatal(err)
	}
	// The nightly is recreated on each run: published, assets still coming.
	publishCLI(c.releases, c.keys, nightlyCLI("06.11.2026 (nightly 7d411bd)", map[string][]byte{"marasi-windows-amd64.exe": cliBinaryNew}))

	result, err := c.app.InstallCLI(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure.Reason != "Nightly release unavailable, try again shortly" {
		t.Fatalf("result = %+v, want the nightly unavailable", result)
	}
}

func TestInstallCLIFollowsTheAppsChannelUnlessOverridden(t *testing.T) {
	for name, tc := range map[string]struct {
		appChannel string
		setting    string
		want       string
	}{
		"release app follows release":       {"release", "", "06.11.2026"},
		"nightly app follows nightly":       {"nightly", "", "07.11.2026 (nightly abc1234)"},
		"dev app follows release":           {"dev", "", "06.11.2026"},
		"release app overridden to nightly": {"release", "nightly", "07.11.2026 (nightly abc1234)"},
		"nightly app overridden to release": {"nightly", "release", "06.11.2026"},
	} {
		t.Run(name, func(t *testing.T) {
			c := newCLIInstall(t, "linux", "amd64")
			c.app.build = BuildInfo{Channel: tc.appChannel, Version: "x"}
			publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": []byte("release")}))
			publishCLI(c.releases, c.keys, nightlyCLI("07.11.2026 (nightly abc1234)", map[string][]byte{"marasi-linux-amd64": []byte("nightly")}))
			if tc.setting != "" {
				if _, err := c.app.SetCLIChannel(tc.setting); err != nil {
					t.Fatal(err)
				}
			}

			result, err := c.app.InstallCLI(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}

			if result.Outcome != "installed" || result.Version != tc.want {
				t.Fatalf("installed %+v, want %s", result, tc.want)
			}
		})
	}
}

func TestSetCLIChannelSavesTheOverride(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	c.app.build = BuildInfo{Channel: "nightly", Version: "x"}

	got, err := c.app.SetCLIChannel("release")
	if err != nil {
		t.Fatal(err)
	}
	if got.Setting != "release" || got.Effective != "release" {
		t.Fatalf("channel = %+v, want release", got)
	}
	if got, _ := c.app.SetCLIChannel("app"); got.Setting != "app" || got.Effective != "nightly" {
		t.Fatalf("channel = %+v, want following the nightly app", got)
	}
	if _, err := c.app.SetCLIChannel("beta"); err == nil {
		t.Fatal("SetCLIChannel(beta) succeeded, want a refusal")
	}
	reloaded, err := LoadConfig(c.app.Config.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.cliChannelSetting() != "" {
		t.Fatalf("saved channel %q, want following the app", reloaded.cliChannelSetting())
	}
}

func TestInstallCLICreatesTheFolderAndRefusesAnInstallWithNoFolder(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))
	dir := filepath.Join(t.TempDir(), "a", "b")

	if _, err := c.app.InstallCLI("  "); err == nil {
		t.Fatal("InstallCLI with no folder succeeded, want a refusal")
	}
	result, err := c.app.InstallCLI(dir)
	if err != nil || result.Outcome != "installed" {
		t.Fatalf("InstallCLI = %+v, %v, want installed", result, err)
	}
}

func TestInstallCLIExpandsAHomeFolder(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	home := t.TempDir()
	c.app.cliRuntime.homeDir = func() (string, error) { return home, nil }
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))

	result, err := c.app.InstallCLI("~/.local/bin")
	if err != nil {
		t.Fatal(err)
	}

	if want := filepath.Join(home, ".local", "bin", "marasi"); result.CLI.Path != want {
		t.Fatalf("installed at %q, want %q", result.CLI.Path, want)
	}
}

func TestDefaultCLIInstallDir(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	if got := c.app.DefaultCLIInstallDir(); got != filepath.Join("/home/researcher", ".local", "bin") {
		t.Fatalf("Unix default = %q", got)
	}
	c.app.cliRuntime.goos = "windows"
	c.app.cliRuntime.getenv = func(name string) string {
		if name == "LOCALAPPDATA" {
			return `C:\Users\r\AppData\Local`
		}
		return ""
	}
	if got := c.app.DefaultCLIInstallDir(); got != filepath.Join(`C:\Users\r\AppData\Local`, "Programs", "marasi") {
		t.Fatalf("Windows default = %q", got)
	}
}

// installedCLI installs data as the CLI at <dir>/marasi and saves it as the
// installed CLI.
func installedCLI(t *testing.T, c *cliInstall, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "marasi")
	if err := os.WriteFile(path, data, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := c.app.Config.setCLIPath(savedCLIPath{Path: path, Source: cliSourceInstalled}); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCheckForCLIUpdateInstallsANewerCLIOverTheCurrentOne(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := installedCLI(t, c, cliBinaryOld)
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "installed" || result.Version != "06.11.2026" {
		t.Fatalf("result = %+v, want 06.11.2026 installed", result)
	}
	data, _ := os.ReadFile(path)
	if !bytes.Equal(data, cliBinaryNew) {
		t.Fatalf("CLI holds %q, want the new build", data)
	}
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi"}) {
		t.Fatalf("folder holds %v, want only marasi", got)
	}
	if result.CLI.Version != "06.11.2026" || result.CLI.Path != path {
		t.Fatalf("CLI = %+v, want the new version at the same path", result.CLI)
	}
}

func TestCheckForCLIUpdateLeavesAnUpToDateCLIAlone(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := installedCLI(t, c, cliBinaryNew)
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": []byte("same day, other bytes")}))

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "up-to-date" {
		t.Fatalf("result = %+v, want up to date", result)
	}
	for _, request := range c.releases.requested() {
		if strings.Contains(request, "/download/") {
			t.Fatalf("downloaded %s, want nothing", request)
		}
	}
	if data, _ := os.ReadFile(path); !bytes.Equal(data, cliBinaryNew) {
		t.Fatal("the CLI changed")
	}
}

func TestCheckForCLIUpdateInstallsTheNightlyOnTheNightlyChannel(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := installedCLI(t, c, cliBinaryOld)
	publishCLI(c.releases, c.keys, releaseCLI("30.10.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryOld}))
	publishCLI(c.releases, c.keys, nightlyCLI("06.11.2026 (nightly 7d411bd)", map[string][]byte{"marasi-linux-amd64": []byte("nightly build")}))
	if _, err := c.app.SetCLIChannel("nightly"); err != nil {
		t.Fatal(err)
	}

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "installed" || result.Version != "06.11.2026 (nightly 7d411bd)" || result.Channel != "nightly" {
		t.Fatalf("result = %+v, want the nightly installed", result)
	}
	if data, _ := os.ReadFile(path); string(data) != "nightly build" {
		t.Fatalf("CLI holds %q, want the nightly", data)
	}
}

func TestCheckForCLIUpdateNeverReplacesADevBuild(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := installedCLI(t, c, []byte("my own build"))
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "dev" {
		t.Fatalf("result = %+v, want a dev build left alone", result)
	}
	if data, _ := os.ReadFile(path); string(data) != "my own build" {
		t.Fatal("the dev build was replaced")
	}
}

func TestCheckForCLIUpdateKeepsTheCurrentCLIWhenTheUpdateFailsVerification(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := installedCLI(t, c, cliBinaryOld)
	r := releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": []byte("evil")})
	r.checksums = cliChecksums(map[string][]byte{"marasi-linux-amd64": cliBinaryNew})
	publishCLI(c.releases, c.keys, r)

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure.Kind != "checksum" {
		t.Fatalf("result = %+v, want a checksum failure", result)
	}
	if data, _ := os.ReadFile(path); !bytes.Equal(data, cliBinaryOld) {
		t.Fatal("the CLI was replaced")
	}
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi"}) {
		t.Fatalf("folder holds %v, want only marasi", got)
	}
}

func TestCheckForCLIUpdateWithNoCLIIsRefused(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")

	if _, err := c.app.CheckForCLIUpdate(); err == nil {
		t.Fatal("CheckForCLIUpdate with no CLI succeeded, want an error")
	}
}

func TestTheBuiltInCLIKeyVerifiesAPublishedMarasiRelease(t *testing.T) {
	// checksums.txt and its signature from Marasi's 30.10.2026 release, as
	// published on GitHub.
	checksums := "ab0021a7c5493e56f78c1a9cce4d3be19f7d45fe68709e94bb10fb502075b005  marasi-linux-amd64\n" +
		"1d91aa117a1fdda9f834b32883ebe92e8d7ba050a410bfe8f770cafcae73fbf0  marasi-darwin-arm64\n" +
		"38b73df4a5548e87fa064a956146a3a2c8b0360b0984cb1d7a67a1b787b94530  marasi-windows-amd64.exe\n"
	signature := "untrusted comment: signature from minisign secret key\n" +
		"RUTKYt9SjZnVCB7Hj4GNxusgpDJkJrxE7HqaS6QGpyYzgTweK9GyYGjooE/evKf4+g0VGd4drO4dS4LNYV3iJEdSP/3U2a6iogw=\n" +
		"trusted comment: marasi release 30.10.2026\n" +
		"+eNj+VPBQV0N+kXJUHFhEs73ttFV61hXZ/f1G59K2OPUuedN7c+TQNDmIQ82F6hcSQ/SSDs+MTvpGStiB3FzAQ==\n"
	key, err := parseMinisignKey(marasiCLIPublicKey)
	if err != nil {
		t.Fatal(err)
	}

	if !minisign.Verify(key, []byte(checksums), []byte(signature)) {
		t.Fatal("the built-in key doesn't verify Marasi's published release")
	}
}

func TestParseCLILdflags(t *testing.T) {
	for ldflags, want := range map[string]cliBuild{
		`-X 'main.version=30.10.2026' -X 'main.buildChannel=release' -X 'main.signingPublicKey=RW'`: {"30.10.2026", "release"},
		`-X 'main.version=06.11.2026 (nightly 7d411bd)' -X 'main.buildChannel=nightly'`:             {"06.11.2026 (nightly 7d411bd)", "nightly"},
		`-X main.version=dev -X main.buildChannel=`:                                                 {"dev", ""},
		`-s -w`: {"dev", ""},
	} {
		if got := parseCLILdflags(ldflags); got != want {
			t.Errorf("parseCLILdflags(%q) = %+v, want %+v", ldflags, got, want)
		}
	}
}

// cliProgress is every cli-install-progress event's payload, in order.
func (c *cliInstall) cliProgress() []CLIInstallProgress {
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	var progress []CLIInstallProgress
	for i, name := range c.events.names {
		if name == "cli-install-progress" {
			progress = append(progress, c.events.data[i][0].(CLIInstallProgress))
		}
	}
	return progress
}

func TestInstallCLIReportsDownloadVerifyAndInstallProgress(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	build := bytes.Repeat([]byte("x"), 3<<20)
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": build}))

	result, err := c.app.InstallCLI(t.TempDir())
	if err != nil || result.Outcome != "installed" {
		t.Fatalf("result = %+v, %v, want installed", result, err)
	}

	progress := c.cliProgress()
	if len(progress) < 4 {
		t.Fatalf("progress = %+v, want download steps, verify and install", progress)
	}
	var steps []string
	for _, p := range progress {
		if len(steps) == 0 || steps[len(steps)-1] != p.Step {
			steps = append(steps, p.Step)
		}
	}
	if want := []string{"download", "verify", "install"}; !slices.Equal(steps, want) {
		t.Fatalf("steps = %v, want %v", steps, want)
	}
	last := progress[0]
	for _, p := range progress {
		if p.Step != "download" {
			break
		}
		if p.Total != int64(len(build)) && p.Received > 0 {
			t.Fatalf("download total = %d, want the build's size %d", p.Total, len(build))
		}
		last = p
	}
	if last.Received != int64(len(build)) {
		t.Fatalf("last download progress = %+v, want all %d bytes", last, len(build))
	}
}

func TestCheckForCLIUpdateReportsProgressOnlyWhenItInstalls(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := filepath.Join(t.TempDir(), "marasi")
	if err := os.WriteFile(path, cliBinaryNew, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := c.app.UseCLIPath(path); err != nil {
		t.Fatal(err)
	}
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))

	result, err := c.app.CheckForCLIUpdate()
	if err != nil || result.Outcome != "up-to-date" {
		t.Fatalf("result = %+v, %v, want up to date", result, err)
	}
	if progress := c.cliProgress(); len(progress) != 0 {
		t.Fatalf("progress = %+v, want none for an up-to-date CLI", progress)
	}
}
