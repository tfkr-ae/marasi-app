//go:build unix

package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// bundleInstaller installs a build that is a macOS app bundle, shipped as
// marasi-app.app.zip. Its install location is the .app bundle enclosing the
// running executable. It is not tied to macOS by a build tag, so tests on
// any Unix can install into a temp directory with it and a fake team
// verifier.
type bundleInstaller struct {
	// assetName is the release asset to install, "marasi-app.app.zip".
	assetName string
	// teamOf returns the Apple developer team the bundle at a path is
	// signed by, or "" when it has none. The real one runs codesign
	// (codesignTeam); tests read a file.
	teamOf func(bundle string) (string, error)
	// original returns the bundle Gatekeeper translocated to a path, the
	// one the researcher opened. The real one asks macOS
	// (translocationOriginal); tests return a temp bundle. When it is nil
	// or fails, a translocated bundle cannot be updated.
	original func(translocated string) (string, error)
}

func (b bundleInstaller) asset() string { return b.assetName }

// locate walks up from the executable (Marasi.app/Contents/MacOS/marasi-app)
// to the .app bundle that encloses it. A translocated bundle's location is
// the bundle it was translocated from, so an app opened straight from
// Downloads updates in Downloads.
func (b bundleInstaller) locate(executable string) (string, error) {
	path, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	for dir := filepath.Dir(path); dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		if strings.EqualFold(filepath.Ext(dir), ".app") {
			return b.untranslocated(dir), nil
		}
	}
	return "", fmt.Errorf("%s is not inside an app bundle", path)
}

// untranslocated is the bundle location was translocated from, or location
// itself when it is not translocated or the original cannot be found.
func (b bundleInstaller) untranslocated(location string) string {
	if !translocated(location) || b.original == nil {
		return location
	}
	original, err := b.original(location)
	if err != nil {
		log.Printf("finding where Marasi was translocated from: %v", err)
		return location
	}
	return original
}

// translocatedReason is what the panel says when Gatekeeper runs Marasi
// from a translocated copy and macOS does not say where it came from.
const translocatedReason = "Move Marasi to Applications to enable updates"

// checkReplaceable refuses a translocated bundle, then tries to create a
// file beside the bundle, which staging and the swap need.
func (b bundleInstaller) checkReplaceable(location string) error {
	if translocated(location) {
		return failed(UpdateFailurePermissions, translocatedReason)
	}
	dir := filepath.Dir(location)
	probe, err := os.CreateTemp(dir, ".marasi-app-write-check-*")
	if err != nil {
		return failed(UpdateFailurePermissions, "Marasi cannot write to %s, where it is installed", dir)
	}
	probe.Close()
	_ = os.Remove(probe.Name())
	return nil
}

// translocated reports whether location is a copy Gatekeeper's App
// Translocation runs a quarantined app from (opened straight from Downloads,
// for example), such as
// /private/var/folders/xx/yyyy/T/AppTranslocation/<UUID>/d/Marasi.app. The
// copy is on a read-only mount, and replacing it would not update the app
// the researcher opens, so it is never replaced: locate replaces the
// original instead.
func translocated(location string) bool {
	for _, part := range strings.Split(filepath.ToSlash(location), "/") {
		if part == "AppTranslocation" {
			return true
		}
	}
	return false
}

// stage unpacks the downloaded zip next to the bundle and returns the
// unpacked app, a hidden .app beside location. Unpacking and the team check
// are part of the verify step; moving the app into its staged place starts
// the install step.
func (b bundleInstaller) stage(download, location string, verified func()) (string, error) {
	dir := filepath.Dir(location)
	unpacked, err := os.MkdirTemp(dir, ".marasi-app-unpack-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(unpacked)
	app, err := unzipApp(download, unpacked)
	if err != nil {
		return "", err
	}
	if err := b.checkTeam(app, location); err != nil {
		return "", err
	}
	verified()
	// The staged app sits directly beside location, so the swap renames
	// within one directory and never moves the running bundle elsewhere.
	staged, err := os.MkdirTemp(dir, ".marasi-app-update-*.app")
	if err != nil {
		return "", err
	}
	if err := os.Remove(staged); err != nil {
		return "", err
	}
	if err := os.Rename(app, staged); err != nil {
		return "", err
	}
	return staged, nil
}

// checkTeam refuses app unless it is signed by the Apple developer team that
// signed the running bundle at location.
func (b bundleInstaller) checkTeam(app, location string) error {
	running, err := b.teamOf(location)
	if err != nil {
		return failed(UpdateFailureTeam, "could not read the developer team of the running Marasi: %w", err)
	}
	if running == "" {
		return failed(UpdateFailureTeam, "the running Marasi is not signed by an Apple developer team, so the new app's developer team cannot be confirmed")
	}
	candidate, err := b.teamOf(app)
	if err != nil {
		return failed(UpdateFailureTeam, "could not read the developer team of the new app: %w", err)
	}
	if candidate != running {
		return failed(UpdateFailureTeam, "the new app is not signed by the Marasi developer team (%s), so it was not installed", running)
	}
	return nil
}

// swap exchanges staged and location in one step, then removes the old
// bundle, which is now at staged.
func (b bundleInstaller) swap(staged, location string) error {
	if err := exchangePaths(staged, location); err != nil {
		return fmt.Errorf("moving the new app into place: %w", err)
	}
	_ = os.RemoveAll(staged)
	return nil
}

func (b bundleInstaller) relaunch(location string) error {
	return openBundle(location)
}

// unzipApp unpacks the zip at archive into dir and returns the one .app it
// holds. Entries outside dir are refused, symlinks are kept and the
// AppleDouble metadata ditto adds (__MACOSX, ._ files) is skipped, since it
// is not part of the signed bundle.
func unzipApp(archive, dir string) (string, error) {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return "", failed(UpdateFailureInstall, "could not open the downloaded app: %w", err)
	}
	defer r.Close()
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", err
	}
	defer root.Close()
	apps := map[string]bool{}
	for _, f := range r.File {
		name := filepath.FromSlash(f.Name)
		if !filepath.IsLocal(name) {
			return "", failed(UpdateFailureInstall, "the downloaded app holds a file outside it: %s", f.Name)
		}
		parts := strings.Split(filepath.ToSlash(filepath.Clean(name)), "/")
		if parts[0] == "__MACOSX" || strings.HasPrefix(parts[len(parts)-1], "._") {
			continue
		}
		if !strings.EqualFold(filepath.Ext(parts[0]), ".app") || len(parts) == 1 && !f.FileInfo().IsDir() {
			return "", failed(UpdateFailureInstall, "the downloaded zip holds %s, which is not part of an app", f.Name)
		}
		apps[parts[0]] = true
		if err := unzipEntry(root, f, name); err != nil {
			return "", failed(UpdateFailureInstall, "could not unpack the downloaded app: %w", err)
		}
	}
	if len(apps) != 1 {
		return "", failed(UpdateFailureInstall, "the downloaded zip holds %d apps, wanted one", len(apps))
	}
	for app := range apps {
		return filepath.Join(dir, app), nil
	}
	return "", nil
}

// unzipEntry writes one zip entry to name inside root, creating its
// parents. root keeps every write, even one through an unpacked symlink,
// inside the unpack directory.
func unzipEntry(root *os.Root, f *zip.File, name string) error {
	mode := f.FileInfo().Mode()
	if mode.IsDir() {
		return root.MkdirAll(name, 0o755)
	}
	if err := root.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		return err
	}
	src, err := f.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	if mode&os.ModeSymlink != 0 {
		target, err := io.ReadAll(io.LimitReader(src, 4096))
		if err != nil {
			return err
		}
		return root.Symlink(string(target), name)
	}
	if !mode.IsRegular() {
		return errors.New(f.Name + " is not a file, folder or symlink")
	}
	dst, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode.Perm()|0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, io.LimitReader(src, maxBuildSize)); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}
