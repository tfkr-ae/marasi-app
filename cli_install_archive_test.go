package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Installing the Marasi CLI from Marasi's archive builds, which networks
// that block bare executables let through.

// archiveEntry is one file in a test archive.
type archiveEntry struct {
	name string
	data []byte
	dir  bool
}

func zipArchive(t *testing.T, entries ...archiveEntry) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for _, e := range entries {
		name := e.name
		if e.dir {
			name += "/"
		}
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(e.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func tarGzArchive(t *testing.T, entries ...archiveEntry) []byte {
	t.Helper()
	var out bytes.Buffer
	gz := gzip.NewWriter(&out)
	w := tar.NewWriter(gz)
	for _, e := range entries {
		header := &tar.Header{Name: e.name, Mode: 0o755, Size: int64(len(e.data)), Typeflag: tar.TypeReg}
		if e.dir {
			header = &tar.Header{Name: e.name + "/", Mode: 0o755, Typeflag: tar.TypeDir}
		}
		if err := w.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(e.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// cliArchive is the platform's archive holding only data as the CLI.
func cliArchive(t *testing.T, goos string, data []byte) []byte {
	t.Helper()
	if goos == "linux" {
		return tarGzArchive(t, archiveEntry{name: "marasi", data: data})
	}
	return zipArchive(t, archiveEntry{name: cliFileName(goos), data: data})
}

func (c *cliInstall) downloads() []string {
	var names []string
	for _, request := range c.releases.requested() {
		if _, name, ok := strings.Cut(request, "/download/"); ok {
			names = append(names, filepath.Base(name))
		}
	}
	return names
}

func TestInstallCLIPrefersThePlatformsArchive(t *testing.T) {
	for _, platform := range []struct {
		goos, goarch, bare, archive, file string
	}{
		{"darwin", "arm64", "marasi-darwin-arm64", "marasi-darwin-arm64.zip", "marasi"},
		{"linux", "amd64", "marasi-linux-amd64", "marasi-linux-amd64.tar.gz", "marasi"},
		{"windows", "amd64", "marasi-windows-amd64.exe", "marasi-windows-amd64.zip", "marasi.exe"},
	} {
		t.Run(platform.goos+"/"+platform.goarch, func(t *testing.T) {
			c := newCLIInstall(t, platform.goos, platform.goarch)
			publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{
				platform.bare:    []byte("bare build"),
				platform.archive: cliArchive(t, platform.goos, []byte("archived build")),
			}))
			dir := filepath.Join(t.TempDir(), "bin")

			result, err := c.app.InstallCLI(dir)
			if err != nil {
				t.Fatal(err)
			}

			if result.Outcome != "installed" {
				t.Fatalf("outcome = %+v, want installed", result)
			}
			installed := filepath.Join(dir, platform.file)
			fileHolds(t, installed, []byte("archived build"))
			if got := dirFiles(t, dir); !slices.Equal(got, []string{platform.file}) {
				t.Fatalf("folder holds %v, want only %s", got, platform.file)
			}
			if platform.goos != "windows" {
				if info, _ := os.Stat(installed); info.Mode()&0o111 == 0 {
					t.Fatalf("mode = %v, want executable", info.Mode())
				}
			}
			if saved := c.app.Config.cliPath(); saved.Path != installed || saved.Source != "installed" {
				t.Fatalf("app config holds %+v, want the installed path", saved)
			}
			if got := c.downloads(); slices.Contains(got, platform.bare) || !slices.Contains(got, platform.archive) {
				t.Fatalf("downloaded %v, want the archive and not the bare build", got)
			}
		})
	}
}

// The archives in testdata/cli-archives come from Marasi's own
// scripts/archive-cli.sh, so this pins the app to the layout Marasi's
// Release and Nightly workflows publish: the asset name per platform and
// one root entry with the platform's file name.
func TestInstallCLIFromTheArchivesMarasiPublishes(t *testing.T) {
	for _, platform := range []struct {
		goos, goarch, bare, archive, file string
	}{
		{"darwin", "arm64", "marasi-darwin-arm64", "marasi-darwin-arm64.zip", "marasi"},
		{"linux", "amd64", "marasi-linux-amd64", "marasi-linux-amd64.tar.gz", "marasi"},
		{"windows", "amd64", "marasi-windows-amd64.exe", "marasi-windows-amd64.zip", "marasi.exe"},
	} {
		t.Run(platform.goos+"/"+platform.goarch, func(t *testing.T) {
			archive, err := os.ReadFile(filepath.Join("testdata", "cli-archives", platform.archive))
			if err != nil {
				t.Fatal(err)
			}
			c := newCLIInstall(t, platform.goos, platform.goarch)
			publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{
				platform.bare:    []byte("bare build"),
				platform.archive: archive,
			}))
			dir := filepath.Join(t.TempDir(), "bin")

			result, err := c.app.InstallCLI(dir)
			if err != nil {
				t.Fatal(err)
			}

			if result.Outcome != "installed" {
				t.Fatalf("outcome = %+v, want installed", result)
			}
			fileHolds(t, filepath.Join(dir, platform.file), []byte("#!/bin/sh\n# Marasi CLI archive fixture: "+platform.bare+"\n"))
			if got := c.downloads(); slices.Contains(got, platform.bare) || !slices.Contains(got, platform.archive) {
				t.Fatalf("downloaded %v, want the archive and not the bare build", got)
			}
		})
	}
}

func TestInstallCLIFallsBackToTheBareBuildWhenTheSignedChecksumsListNoArchive(t *testing.T) {
	for name, release := range map[string]func(t *testing.T) cliRelease{
		"a release without archives": func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew})
		},
		"an archive the signed checksums don't list": func(t *testing.T) cliRelease {
			r := releaseCLI("06.11.2026", map[string][]byte{
				"marasi-linux-amd64":        cliBinaryNew,
				"marasi-linux-amd64.tar.gz": cliArchive(t, "linux", []byte("unlisted")),
			})
			r.checksums = cliChecksums(map[string][]byte{"marasi-linux-amd64": cliBinaryNew})
			return r
		},
	} {
		t.Run(name, func(t *testing.T) {
			c := newCLIInstall(t, "linux", "amd64")
			publishCLI(c.releases, c.keys, release(t))
			dir := t.TempDir()

			result, err := c.app.InstallCLI(dir)
			if err != nil {
				t.Fatal(err)
			}

			if result.Outcome != "installed" {
				t.Fatalf("outcome = %+v, want installed", result)
			}
			fileHolds(t, filepath.Join(dir, "marasi"), cliBinaryNew)
			if got := c.downloads(); slices.Contains(got, "marasi-linux-amd64.tar.gz") {
				t.Fatalf("downloaded %v, want only the bare build", got)
			}
		})
	}
}

func TestInstallCLIFromABadArchiveFailsClosed(t *testing.T) {
	for name, tc := range map[string]struct {
		goos, goarch string
		release      func(t *testing.T) cliRelease
		kind         string
	}{
		"an archive that doesn't match its checksum": {"linux", "amd64", func(t *testing.T) cliRelease {
			r := releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64.tar.gz": cliArchive(t, "linux", []byte("evil"))})
			r.checksums = cliChecksums(map[string][]byte{"marasi-linux-amd64.tar.gz": cliArchive(t, "linux", cliBinaryNew)})
			return r
		}, "checksum"},
		"a tar.gz with a second entry": {"linux", "amd64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64.tar.gz": tarGzArchive(t,
				archiveEntry{name: "marasi", data: cliBinaryNew}, archiveEntry{name: "README", data: []byte("hi")})})
		}, "install"},
		"a tar.gz whose entry isn't named marasi": {"linux", "amd64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64.tar.gz": tarGzArchive(t,
				archiveEntry{name: "bin/marasi", data: cliBinaryNew})})
		}, "install"},
		"a tar.gz holding a folder": {"linux", "amd64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64.tar.gz": tarGzArchive(t,
				archiveEntry{name: "marasi", dir: true})})
		}, "install"},
		"a zip with a second entry": {"darwin", "arm64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-darwin-arm64.zip": zipArchive(t,
				archiveEntry{name: "marasi", data: cliBinaryNew}, archiveEntry{name: "marasi.sig", data: []byte("x")})})
		}, "install"},
		"a zip whose entry isn't named marasi": {"darwin", "arm64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-darwin-arm64.zip": zipArchive(t,
				archiveEntry{name: "../marasi", data: cliBinaryNew})})
		}, "install"},
		"a Windows zip holding marasi without .exe": {"windows", "amd64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-windows-amd64.zip": zipArchive(t,
				archiveEntry{name: "marasi", data: cliBinaryNew})})
		}, "install"},
		"a file that isn't an archive": {"darwin", "arm64", func(t *testing.T) cliRelease {
			return releaseCLI("06.11.2026", map[string][]byte{"marasi-darwin-arm64.zip": cliBinaryNew})
		}, "install"},
	} {
		t.Run(name, func(t *testing.T) {
			c := newCLIInstall(t, tc.goos, tc.goarch)
			publishCLI(c.releases, c.keys, tc.release(t))
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
			if saved := c.app.Config.cliPath(); saved.Path != "" {
				t.Fatalf("app config holds %+v, want nothing saved", saved)
			}
		})
	}
}

func TestInstallCLIFromAnArchiveReportsTheExtractStep(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{
		"marasi-linux-amd64.tar.gz": cliArchive(t, "linux", cliBinaryNew),
	}))

	if result, err := c.app.InstallCLI(t.TempDir()); err != nil || result.Outcome != "installed" {
		t.Fatalf("result = %+v, %v, want installed", result, err)
	}

	var steps []string
	for _, p := range c.cliProgress() {
		if len(steps) == 0 || steps[len(steps)-1] != p.Step {
			steps = append(steps, p.Step)
		}
	}
	if want := []string{"download", "verify", "extract", "install"}; !slices.Equal(steps, want) {
		t.Fatalf("steps = %v, want %v", steps, want)
	}
}

func TestCheckForCLIUpdateInstallsTheArchivedCLIOverTheCurrentOne(t *testing.T) {
	c := newCLIInstall(t, "darwin", "arm64")
	path := installedCLI(t, c, cliBinaryOld)
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{
		"marasi-darwin-arm64":     []byte("bare build"),
		"marasi-darwin-arm64.zip": cliArchive(t, "darwin", cliBinaryNew),
	}))

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "installed" || result.CLI.Version != "06.11.2026" || result.CLI.Path != path {
		t.Fatalf("result = %+v, want 06.11.2026 installed at the same path", result)
	}
	fileHolds(t, path, cliBinaryNew)
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi"}) {
		t.Fatalf("folder holds %v, want only marasi", got)
	}
}

func TestCheckForCLIUpdateKeepsTheCurrentCLIWhenTheArchiveIsBad(t *testing.T) {
	c := newCLIInstall(t, "linux", "amd64")
	path := installedCLI(t, c, cliBinaryOld)
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{
		"marasi-linux-amd64.tar.gz": tarGzArchive(t,
			archiveEntry{name: "marasi", data: cliBinaryNew}, archiveEntry{name: "marasi-helper", data: []byte("x")}),
	}))

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" {
		t.Fatalf("result = %+v, want failed", result)
	}
	fileHolds(t, path, cliBinaryOld)
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi"}) {
		t.Fatalf("folder holds %v, want only marasi", got)
	}
}
