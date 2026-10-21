//go:build unix

package main

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aead.dev/minisign"
)

// Install tests for the macOS app bundle. They run on any Unix with a fake
// team verifier: the bundle's signing team is read from a TEAM file inside
// it, where codesign would read the signature.

// macBundle is the content of a fake Marasi.app: its executable, a
// framework-style symlink and the team it is signed by.
type macBundle struct {
	executable []byte
	team       string
}

var (
	runningBundle = macBundle{executable: runningBinary, team: "MARASITEAM"}
	updateBundle  = macBundle{executable: updateBinary, team: "MARASITEAM"}
)

// writeBundle lays bundle out as an .app at path.
func writeBundle(t *testing.T, path string, bundle macBundle) {
	t.Helper()
	macos := filepath.Join(path, "Contents", "MacOS")
	if err := os.MkdirAll(macos, 0o755); err != nil {
		t.Fatalf("making %s: %v", macos, err)
	}
	files := map[string][]byte{
		filepath.Join(macos, "marasi-app"):            bundle.executable,
		filepath.Join(path, "Contents", "Info.plist"): []byte("<plist/>"),
		filepath.Join(path, "Contents", "TEAM"):       []byte(bundle.team),
	}
	for name, data := range files {
		if err := os.WriteFile(name, data, 0o755); err != nil {
			t.Fatalf("writing %s: %v", name, err)
		}
	}
	if err := os.Symlink("MacOS/marasi-app", filepath.Join(path, "Contents", "Current")); err != nil {
		t.Fatalf("linking: %v", err)
	}
}

// zipBundle is marasi-app.app.zip as `ditto -c -k --keepParent` writes it:
// the bundle under its own name, symlinks kept as links, and AppleDouble
// metadata beside it.
func zipBundle(t *testing.T, bundle macBundle) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	add := func(name string, mode os.FileMode, data []byte) {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(mode)
		f, err := w.CreateHeader(header)
		if err != nil {
			t.Fatalf("zipping %s: %v", name, err)
		}
		if _, err := f.Write(data); err != nil {
			t.Fatalf("zipping %s: %v", name, err)
		}
	}
	add("Marasi.app/", os.ModeDir|0o755, nil)
	add("Marasi.app/Contents/", os.ModeDir|0o755, nil)
	add("Marasi.app/Contents/MacOS/", os.ModeDir|0o755, nil)
	add("Marasi.app/Contents/MacOS/marasi-app", 0o755, bundle.executable)
	add("Marasi.app/Contents/Info.plist", 0o644, []byte("<plist/>"))
	add("Marasi.app/Contents/TEAM", 0o644, []byte(bundle.team))
	add("Marasi.app/Contents/Current", os.ModeSymlink|0o755, []byte("MacOS/marasi-app"))
	add("__MACOSX/Marasi.app/._Contents", 0o644, []byte("appledouble"))
	if err := w.Close(); err != nil {
		t.Fatalf("zipping: %v", err)
	}
	return out.Bytes()
}

// publishSignedBundle publishes tag with zipped as marasi-app.app.zip and
// signed checksums for it.
func publishSignedBundle(releases *fakeReleaseServer, keys signingKeys, tag string, zipped []byte) {
	releases.publishRelease(tag, "Notes.")
	releases.addAsset(tag, "marasi-app.app.zip", zipped)
	checksums := checksumsFor(map[string][]byte{"marasi-app.app.zip": zipped})
	releases.addAsset(tag, "checksums.txt", checksums)
	releases.addAsset(tag, "checksums.txt.minisig", minisign.Sign(keys.private, checksums))
}

// teamFile is the fake team verifier: the team named in the bundle's TEAM
// file.
func teamFile(bundle string) (string, error) {
	data, err := os.ReadFile(filepath.Join(bundle, "Contents", "TEAM"))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	return strings.TrimSpace(string(data)), err
}

// newBundleApp returns an App running release 16.10.2026 from Marasi.app in
// a temp Applications directory (at rel inside it), signed by the Marasi
// team, that has found the update releases publishes.
func newBundleApp(t *testing.T, releases *fakeReleaseServer, keys signingKeys, rel string) (*App, *recordedEvents) {
	t.Helper()
	app, events := newUpdateApp(t, "release", "16.10.2026", releases)
	app.installLocation = filepath.Join(t.TempDir(), rel)
	writeBundle(t, app.installLocation, runningBundle)
	app.installer = bundleInstaller{assetName: "marasi-app.app.zip", teamOf: teamFile}
	app.signingKey = &keys.public
	if check := app.CheckForUpdate(); check.Outcome != UpdateOutcomeAvailable {
		t.Fatalf("wanted an update to install, got %q (%s)", check.Outcome, check.Reason)
	}
	return app, events
}

// assertBundle fails unless the bundle at location holds want, with its
// executable executable and its symlink still a symlink.
func assertBundle(t *testing.T, location string, want macBundle) {
	t.Helper()
	executable := filepath.Join(location, "Contents", "MacOS", "marasi-app")
	assertInstalled(t, executable, want.executable)
	if team, _ := teamFile(location); team != want.team {
		t.Fatalf("wanted the bundle signed by %s, got %q", want.team, team)
	}
	link, err := os.Readlink(filepath.Join(location, "Contents", "Current"))
	if err != nil || link != "MacOS/marasi-app" {
		t.Fatalf("wanted the bundle's symlink kept, got %q (%v)", link, err)
	}
	if _, err := os.Stat(filepath.Join(location, "Contents", "._Contents")); err == nil {
		t.Fatalf("wanted no AppleDouble metadata unpacked into the bundle")
	}
}

func TestInstallingOnMacOSReplacesTheAppBundle(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedBundle(releases, keys, "17.10.2026", zipBundle(t, updateBundle))
	app, events := newBundleApp(t, releases, keys, "Marasi.app")

	result, err := app.InstallUpdate()

	if err != nil || result.Outcome != InstallOutcomeInstalled {
		t.Fatalf("wanted the update installed, got %+v (%v)", result, err)
	}
	assertBundle(t, app.installLocation, updateBundle)
	assertOnlyFile(t, app.installLocation)
	if !events.has(updateInstalledEvent) {
		t.Fatalf("wanted a %s event, got %v", updateInstalledEvent, events.names)
	}
}

// assertBundleFailed fails unless the install failed with kind at step and a reason
// containing reason, emitted it, and left the running bundle as running with
// nothing staged beside it.
func assertBundleFailed(t *testing.T, app *App, events *recordedEvents, result UpdateInstall, running macBundle, kind UpdateFailureKind, step InstallStep, reason string) {
	t.Helper()
	if result.Outcome != InstallOutcomeFailed || result.Failure == nil {
		t.Fatalf("wanted a failed install, got %+v", result)
	}
	if result.Failure.Kind != kind || !strings.Contains(result.Failure.Reason, reason) {
		t.Fatalf("wanted a %s failure saying %q, got %s: %s", kind, reason, result.Failure.Kind, result.Failure.Reason)
	}
	if result.Failure.Step != step {
		t.Fatalf("wanted the %s failure to stop at the %s step, got %q", kind, step, result.Failure.Step)
	}
	if result.Failure.ReleasePage == "" {
		t.Fatalf("wanted the failure to link the release page, got %+v", result.Failure)
	}
	assertBundle(t, app.installLocation, running)
	assertOnlyFile(t, app.installLocation)
	if data, ok := events.first(updateFailedEvent); !ok || data[0] != *result.Failure {
		t.Fatalf("wanted a %s event carrying the failure, got %v", updateFailedEvent, events.names)
	}
	if events.has(updateInstalledEvent) {
		t.Fatalf("wanted no %s event, got %v", updateInstalledEvent, events.names)
	}
}

func TestAppSignedByAnotherDeveloperTeamIsRefused(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	impostor := macBundle{executable: updateBinary, team: "OTHERTEAM"}
	publishSignedBundle(releases, keys, "17.10.2026", zipBundle(t, impostor))
	app, events := newBundleApp(t, releases, keys, "Marasi.app")

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertBundleFailed(t, app, events, result, runningBundle, UpdateFailureTeam, InstallStepVerify, "developer team")
}

func TestRunningAppWithoutADeveloperTeamRefusesTheUpdate(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedBundle(releases, keys, "17.10.2026", zipBundle(t, updateBundle))
	app, events := newBundleApp(t, releases, keys, "Marasi.app")
	if err := os.Remove(filepath.Join(app.installLocation, "Contents", "TEAM")); err != nil {
		t.Fatalf("unsigning the running app: %v", err)
	}

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	unsigned := macBundle{executable: runningBinary, team: ""}
	assertBundleFailed(t, app, events, result, unsigned, UpdateFailureTeam, InstallStepVerify, "developer team")
}

func TestATranslocatedAppWhoseOriginalIsUnknownAsksToBeMovedToApplications(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedBundle(releases, keys, "17.10.2026", zipBundle(t, updateBundle))
	// Gatekeeper runs a quarantined app opened from Downloads from a
	// read-only copy under a path like this one.
	translocated := filepath.Join("T", "AppTranslocation", "6A1E4E1B-6B5C-4C1E-9F6A-2B7E7E0A4C11", "d", "Marasi.app")
	app, events := newBundleApp(t, releases, keys, translocated)

	state := app.GetUpdateState()
	if state.CanInstall || state.CannotInstallReason != "Move Marasi to Applications to enable updates" {
		t.Fatalf("wanted Install not offered from a translocated path, got %+v", state)
	}
	requests := releases.requestCount()
	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertBundleFailed(t, app, events, result, runningBundle, UpdateFailurePermissions, InstallStepInstall, "Move Marasi to Applications")
	if releases.requestCount() != requests {
		t.Fatalf("wanted nothing downloaded, got %v", releases.requested())
	}
}

func TestAnAppOpenedFromDownloadsUpdatesInDownloads(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedBundle(releases, keys, "17.10.2026", zipBundle(t, updateBundle))
	app, events := newBundleApp(t, releases, keys, filepath.Join("Downloads", "Marasi.app"))
	downloads := app.installLocation
	// Gatekeeper runs the quarantined app from a read-only copy of it.
	translocated := filepath.Join(t.TempDir(), "T", "AppTranslocation", "6A1E4E1B-6B5C-4C1E-9F6A-2B7E7E0A4C11", "d", "Marasi.app")
	writeBundle(t, translocated, runningBundle)
	installer := app.installer.(bundleInstaller)
	installer.original = func(location string) (string, error) {
		if location != mustEvalSymlinks(t, translocated) {
			return "", fmt.Errorf("%s was not translocated", location)
		}
		return downloads, nil
	}
	app.installer = installer
	location, err := installer.locate(filepath.Join(translocated, "Contents", "MacOS", "marasi-app"))
	if err != nil || location != downloads {
		t.Fatalf("wanted the translocated app located at %s, got %q (%v)", downloads, location, err)
	}
	app.installLocation = location

	result, err := app.InstallUpdate()

	if err != nil || result.Outcome != InstallOutcomeInstalled {
		t.Fatalf("wanted the update installed, got %+v (%v)", result, err)
	}
	assertBundle(t, downloads, updateBundle)
	assertOnlyFile(t, downloads)
	assertBundle(t, translocated, runningBundle)
	if !events.has(updateInstalledEvent) {
		t.Fatalf("wanted a %s event, got %v", updateInstalledEvent, events.names)
	}
}

func TestATranslocatedAppWhoseOriginalIsUnknownStaysWhereItRuns(t *testing.T) {
	translocated := filepath.Join(t.TempDir(), "T", "AppTranslocation", "6A1E4E1B-6B5C-4C1E-9F6A-2B7E7E0A4C11", "d", "Marasi.app")
	writeBundle(t, translocated, runningBundle)
	installer := bundleInstaller{
		assetName: "marasi-app.app.zip",
		teamOf:    teamFile,
		original:  func(string) (string, error) { return "", errors.New("not translocated") },
	}

	got, err := installer.locate(filepath.Join(translocated, "Contents", "MacOS", "marasi-app"))

	if want := mustEvalSymlinks(t, translocated); err != nil || got != want {
		t.Fatalf("wanted %s, got %q (%v)", want, got, err)
	}
}

// mustEvalSymlinks is path with its symlinks resolved, as locate sees it:
// the temp directory is under /var, a symlink to /private/var, on macOS.
func mustEvalSymlinks(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("resolving %s: %v", path, err)
	}
	return resolved
}

func TestTheInstallLocationIsTheEnclosingAppBundle(t *testing.T) {
	dir := t.TempDir()
	location := filepath.Join(dir, "Marasi.app")
	writeBundle(t, location, runningBundle)
	installer := bundleInstaller{assetName: "marasi-app.app.zip", teamOf: teamFile}

	got, err := installer.locate(filepath.Join(location, "Contents", "MacOS", "marasi-app"))

	want, _ := filepath.EvalSymlinks(location)
	if err != nil || got != want {
		t.Fatalf("wanted %s, got %q (%v)", want, got, err)
	}
}

func TestZipEntriesOutsideTheAppAreRefused(t *testing.T) {
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for _, name := range []string{"Marasi.app/Contents/MacOS/marasi-app", "Marasi.app/../../escaped"} {
		f, _ := w.Create(name)
		_, _ = f.Write(updateBinary)
	}
	_ = w.Close()
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedBundle(releases, keys, "17.10.2026", out.Bytes())
	app, events := newBundleApp(t, releases, keys, "Marasi.app")

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertBundleFailed(t, app, events, result, runningBundle, UpdateFailureInstall, InstallStepVerify, "outside")
	if _, err := os.Stat(filepath.Join(filepath.Dir(filepath.Dir(app.installLocation)), "escaped")); err == nil {
		t.Fatalf("wanted nothing written outside the install directory")
	}
}
