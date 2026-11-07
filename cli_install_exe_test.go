package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// windowsFiles fakes how Windows treats the executable of a running
// process: it can be renamed, but not overwritten or deleted.
type windowsFiles struct {
	running map[string]bool
}

var errFileInUse = errors.New("The process cannot access the file because it is being used by another process.")

// onWindows makes c install on windows/amd64 through files that follow
// Windows' rules for running executables.
func (c *cliInstall) onWindows() *windowsFiles {
	files := &windowsFiles{running: map[string]bool{}}
	r := &c.app.cliRuntime
	r.goos, r.goarch = "windows", "amd64"
	r.rename = func(from, to string) error {
		if files.running[to] {
			return &os.LinkError{Op: "rename", Old: from, New: to, Err: errFileInUse}
		}
		if err := os.Rename(from, to); err != nil {
			return err
		}
		if files.running[from] {
			delete(files.running, from)
			files.running[to] = true
		}
		return nil
	}
	r.remove = func(path string) error {
		if files.running[path] {
			return &os.PathError{Op: "remove", Path: path, Err: errFileInUse}
		}
		return os.RemoveAll(path)
	}
	return files
}

// runningWindowsCLI installs data as marasi.exe, saved as the installed
// CLI, with the local instance running from it.
func runningWindowsCLI(t *testing.T, c *cliInstall, files *windowsFiles, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "marasi.exe")
	if err := os.WriteFile(path, data, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := c.app.Config.setCLIPath(savedCLIPath{Path: path, Source: cliSourceInstalled}); err != nil {
		t.Fatal(err)
	}
	files.running[path] = true
	return path
}

func publishWindowsUpdate(c *cliInstall) {
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-windows-amd64.exe": cliBinaryNew}))
}

func fileHolds(t *testing.T, path string, want []byte) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", filepath.Base(path), err)
	}
	if !bytes.Equal(data, want) {
		t.Fatalf("%s holds %q, want %q", filepath.Base(path), data, want)
	}
}

func TestCheckForCLIUpdateOnWindowsMovesTheRunningCLIAsideAndInstallsTheNewOne(t *testing.T) {
	c := newCLIInstall(t, "windows", "amd64")
	files := c.onWindows()
	path := runningWindowsCLI(t, c, files, cliBinaryOld)
	publishWindowsUpdate(c)

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "installed" {
		t.Fatalf("result = %+v, want installed", result)
	}
	fileHolds(t, path, cliBinaryNew)
	fileHolds(t, path+".old", cliBinaryOld)
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi.exe", "marasi.exe.old"}) {
		t.Fatalf("folder holds %v, want marasi.exe and the running marasi.exe.old", got)
	}
}

func TestCheckForCLIUpdateOnWindowsPutsTheRunningCLIBackWhenTheNewOneCannotMoveIn(t *testing.T) {
	c := newCLIInstall(t, "windows", "amd64")
	files := c.onWindows()
	path := runningWindowsCLI(t, c, files, cliBinaryOld)
	publishWindowsUpdate(c)
	rename := c.app.cliRuntime.rename
	c.app.cliRuntime.rename = func(from, to string) error {
		if strings.HasPrefix(filepath.Base(from), ".marasi.exe.") {
			return errors.New("disk full")
		}
		return rename(from, to)
	}

	result, err := c.app.CheckForCLIUpdate()
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure == nil || result.Failure.Kind != "install" {
		t.Fatalf("result = %+v, want an install failure", result)
	}
	fileHolds(t, path, cliBinaryOld)
	if !files.running[path] {
		t.Fatal("the running CLI was not put back at marasi.exe")
	}
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi.exe"}) {
		t.Fatalf("folder holds %v, want only marasi.exe", got)
	}
}

func TestStartupRemovesTheCLIMovedAsideOnceItsProcessHasExited(t *testing.T) {
	c := newCLIInstall(t, "windows", "amd64")
	files := c.onWindows()
	path := runningWindowsCLI(t, c, files, cliBinaryOld)
	publishWindowsUpdate(c)
	if result, _ := c.app.CheckForCLIUpdate(); result.Outcome != "installed" {
		t.Fatalf("update = %+v, want installed", result)
	}
	// The previous instance is still exiting when the app starts, then
	// exits during the first wait.
	var waits []time.Duration
	c.app.cliRuntime.sleep = func(d time.Duration) {
		waits = append(waits, d)
		delete(files.running, path+".old")
	}

	c.app.removeCLILeftovers()

	if len(waits) != 1 {
		t.Fatalf("waited %v, want one wait for the old process to exit", waits)
	}
	if got := dirFiles(t, filepath.Dir(path)); !slices.Equal(got, []string{"marasi.exe"}) {
		t.Fatalf("folder holds %v, want only marasi.exe", got)
	}
	fileHolds(t, path, cliBinaryNew)
}

func TestInstallingTheCLIOnWindowsAgainReplacesALeftoverNotYetRemoved(t *testing.T) {
	c := newCLIInstall(t, "windows", "amd64")
	files := c.onWindows()
	path := runningWindowsCLI(t, c, files, cliBinaryOld)
	if err := os.WriteFile(path+".old", []byte("older"), 0o755); err != nil {
		t.Fatal(err)
	}
	publishWindowsUpdate(c)

	if result, _ := c.app.CheckForCLIUpdate(); result.Outcome != "installed" {
		t.Fatalf("update = %+v, want installed", result)
	}

	fileHolds(t, path, cliBinaryNew)
	fileHolds(t, path+".old", cliBinaryOld)
}
