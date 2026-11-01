package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"aead.dev/minisign"
)

// The running build in install tests, and what a signed release replaces it
// with.
var (
	runningBinary = []byte("#!/bin/sh\necho marasi 16.10.2026\n")
	updateBinary  = []byte("#!/bin/sh\necho marasi 17.10.2026\n")
)

// signingKeys is a Marasi signing key made for one test.
type signingKeys struct {
	public  minisign.PublicKey
	private minisign.PrivateKey
}

func newSigningKeys(t *testing.T) signingKeys {
	t.Helper()
	public, private, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generating a signing key: %v", err)
	}
	return signingKeys{public: public, private: private}
}

// checksumsFor is checksums.txt as CI writes it (sha256sum output) for the
// named assets.
func checksumsFor(assets map[string][]byte) []byte {
	var out bytes.Buffer
	for _, name := range []string{"marasi-app", "marasi-app.exe", "marasi-app.app.zip"} {
		if data, ok := assets[name]; ok {
			fmt.Fprintf(&out, "%x  %s\n", sha256.Sum256(data), name)
		}
	}
	return out.Bytes()
}

// publishSignedRelease publishes tag with a Linux binary, its checksums.txt
// and a signature over the checksums made with keys, as the publish job does.
func publishSignedRelease(releases *fakeReleaseServer, keys signingKeys, tag string, binary []byte) {
	checksums := checksumsFor(map[string][]byte{"marasi-app": binary})
	publishRelease(releases, tag, binary, checksums, minisign.Sign(keys.private, checksums))
}

// publishRelease publishes tag with the given Linux binary, checksums.txt
// and signature; nil leaves an asset out.
func publishRelease(releases *fakeReleaseServer, tag string, binary, checksums, signature []byte) {
	releases.publishRelease(tag, "Notes.")
	if binary != nil {
		releases.addAsset(tag, "marasi-app", binary)
	}
	if checksums != nil {
		releases.addAsset(tag, "checksums.txt", checksums)
	}
	if signature != nil {
		releases.addAsset(tag, "checksums.txt.minisig", signature)
	}
}

// newInstallApp returns an App running release 16.10.2026 on Linux from a
// temp install directory, trusting keys, that has found the update releases
// publishes.
func newInstallApp(t *testing.T, releases *fakeReleaseServer, keys signingKeys) (*App, *recordedEvents) {
	t.Helper()
	app, events := newUpdateApp(t, "release", "16.10.2026", releases)
	dir := t.TempDir()
	app.installLocation = filepath.Join(dir, "marasi-app")
	if err := os.WriteFile(app.installLocation, runningBinary, 0o755); err != nil {
		t.Fatalf("writing the running build: %v", err)
	}
	app.installer = binaryInstaller{assetName: "marasi-app"}
	app.signingKey = &keys.public
	if check := app.CheckForUpdate(); check.Outcome != UpdateOutcomeAvailable {
		t.Fatalf("wanted an update to install, got %q (%s)", check.Outcome, check.Reason)
	}
	return app, events
}

// assertInstalled fails unless the install location holds want, executable.
func assertInstalled(t *testing.T, location string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(location)
	if err != nil {
		t.Fatalf("reading the install location: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("wanted the install location to hold %q, got %q", want, got)
	}
	info, err := os.Stat(location)
	if err != nil {
		t.Fatalf("checking the install location: %v", err)
	}
	if info.Mode().Perm()&0o111 != 0o111 {
		t.Fatalf("wanted the installed build executable, got mode %v", info.Mode())
	}
}

// assertOnlyFile fails unless the install directory holds just the install
// location, so nothing staged or downloaded is left behind.
func assertOnlyFile(t *testing.T, location string) {
	t.Helper()
	entries, err := os.ReadDir(filepath.Dir(location))
	if err != nil {
		t.Fatalf("listing the install directory: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(location) {
		var names []string
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("wanted only %s in the install directory, got %v", filepath.Base(location), names)
	}
}

func TestInstallingAnUpdateReplacesTheBuildOnDiskAndKeepsItExecutable(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	if result.Outcome != InstallOutcomeInstalled || result.Failure != nil {
		t.Fatalf("wanted the update installed, got %+v", result)
	}
	assertInstalled(t, app.installLocation, updateBinary)
	assertOnlyFile(t, app.installLocation)
	data, ok := events.first(updateInstalledEvent)
	if !ok || len(data) != 1 {
		t.Fatalf("wanted one %s event, got %v", updateInstalledEvent, events.names)
	}
	if installed, _ := data[0].(Update); installed.Version != "17.10.2026" {
		t.Fatalf("wanted the event to carry the installed update, got %+v", data[0])
	}
	if state := app.GetUpdateState(); state.Status != UpdateStatusRestartPending {
		t.Fatalf("wanted a pending restart, got %+v", state)
	}
}

func TestNothingDownloadsUntilInstallIsChosen(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, _ := newInstallApp(t, releases, keys)
	app.GetUpdateState()

	for _, request := range releases.requested() {
		if strings.Contains(request, "/download/") {
			t.Fatalf("wanted no download before Install, got %v", releases.requested())
		}
	}
}

func TestInstallReportsDownloadProgress(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	big := bytes.Repeat([]byte("marasi"), 200_000)
	publishSignedRelease(releases, keys, "17.10.2026", big)
	app, events := newInstallApp(t, releases, keys)

	if _, err := app.InstallUpdate(); err != nil {
		t.Fatalf("installing: %v", err)
	}

	progress := progressEvents(events)
	if len(progress) < 3 {
		t.Fatalf("wanted progress as the build downloads, got %+v", progress)
	}
	total := int64(len(big))
	if first := progress[0]; first.Received != 0 || first.Total != total {
		t.Fatalf("wanted progress to start at 0 of %d, got %+v", total, first)
	}
	if last := progress[len(progress)-1]; last.Received != total || last.Total != total {
		t.Fatalf("wanted progress to end at %d of %d, got %+v", total, total, last)
	}
	for i := 1; i < len(progress); i++ {
		if progress[i].Received < progress[i-1].Received {
			t.Fatalf("wanted progress to only grow, got %+v", progress)
		}
	}
	if len(progress) > 102 {
		t.Fatalf("wanted at most one progress event per percent, got %d", len(progress))
	}
}

func TestInstallReportsEachStepAsItStartsInTheEventsAndTheState(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	// What a frontend reloaded at each progress event would read.
	var stateSteps []InstallStep
	app.emitEvent = func(name string, data ...any) {
		if name == updateProgressEvent {
			if state := app.GetUpdateState(); state.Progress != nil {
				stateSteps = append(stateSteps, state.Progress.Step)
			} else {
				stateSteps = append(stateSteps, "")
			}
		}
		events.emit(name, data...)
	}

	if _, err := app.InstallUpdate(); err != nil {
		t.Fatalf("installing: %v", err)
	}

	var eventSteps []InstallStep
	for _, progress := range progressEvents(events) {
		eventSteps = append(eventSteps, progress.Step)
	}
	want := []InstallStep{InstallStepDownload, InstallStepVerify, InstallStepInstall}
	if got := slices.Compact(slices.Clone(eventSteps)); !slices.Equal(got, want) {
		t.Fatalf("wanted progress events through the steps %v, got %v", want, eventSteps)
	}
	if !slices.Equal(stateSteps, eventSteps) {
		t.Fatalf("wanted the state to report each event's step %v, got %v", eventSteps, stateSteps)
	}
	if last := progressEvents(events)[len(eventSteps)-1]; last.Received != int64(len(updateBinary)) {
		t.Fatalf("wanted the later steps to keep the finished download's size, got %+v", last)
	}
	if state := app.GetUpdateState(); state.Progress != nil {
		t.Fatalf("wanted no step once installed, got %+v", state.Progress)
	}
}

// progressEvents is the progress reported so far, in order.
func progressEvents(events *recordedEvents) []UpdateProgress {
	events.mu.Lock()
	defer events.mu.Unlock()
	var progress []UpdateProgress
	for i, name := range events.names {
		if name == updateProgressEvent {
			progress = append(progress, events.data[i][0].(UpdateProgress))
		}
	}
	return progress
}

func TestCancellingTheDownloadKeepsTheUpdateAvailable(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	releases.stall("17.10.2026", "marasi-app")
	app, events := newInstallApp(t, releases, keys)

	done := make(chan UpdateInstall)
	go func() {
		result, err := app.InstallUpdate()
		if err != nil {
			t.Errorf("installing: %v", err)
		}
		done <- result
	}()
	waitFor(t, "the download to start", func() bool {
		state := app.GetUpdateState()
		return state.Status == UpdateStatusDownloading && state.Progress != nil && state.Progress.Received > 0
	})
	app.CancelUpdateDownload()

	var result UpdateInstall
	select {
	case result = <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for the cancelled install to end")
	}
	if result.Outcome != InstallOutcomeCancelled || result.Failure != nil {
		t.Fatalf("wanted a cancelled install, got %+v", result)
	}
	assertInstalled(t, app.installLocation, runningBinary)
	assertOnlyFile(t, app.installLocation)
	if events.has(updateFailedEvent) || events.has(updateInstalledEvent) {
		t.Fatalf("wanted no failed or installed event, got %v", events.names)
	}
	if state := app.GetUpdateState(); state.Status != UpdateStatusAvailable || state.Update == nil || state.Progress != nil {
		t.Fatalf("wanted the update available again, got %+v", state)
	}
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestUnwritableInstallLocationOffersOnlyTheReleasePage(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can write to a read-only directory")
	}
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	dir := filepath.Dir(app.installLocation)
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatalf("making the install directory read-only: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	state := app.GetUpdateState()
	if state.CanInstall || !strings.Contains(state.CannotInstallReason, "cannot write to "+dir) {
		t.Fatalf("wanted Install not offered because %s is read-only, got %+v", dir, state)
	}
	requests := releases.requestCount()
	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertFailed(t, app, events, result, UpdateFailurePermissions, InstallStepInstall, "cannot write to "+dir)
	assertFoundBeforeDownloading(t, result)
	if releases.requestCount() != requests {
		t.Fatalf("wanted nothing downloaded, got %v", releases.requested())
	}
}

func TestWritableInstallLocationOffersInstall(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, _ := newInstallApp(t, releases, keys)

	state := app.GetUpdateState()

	if !state.CanInstall || state.CannotInstallReason != "" {
		t.Fatalf("wanted Install offered, got %+v", state)
	}
	assertOnlyFile(t, app.installLocation)
}

func TestBuildWithoutASigningKeyCannotInstall(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	app.signingKey = nil

	if state := app.GetUpdateState(); state.CanInstall || !strings.Contains(state.CannotInstallReason, "no Marasi signing key") {
		t.Fatalf("wanted Install not offered without a signing key, got %+v", state)
	}
	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertFailed(t, app, events, result, UpdateFailureSignature, InstallStepVerify, "no Marasi signing key")
	assertFoundBeforeDownloading(t, result)
}

func TestInstallWithoutAnUpdateIsRefused(t *testing.T) {
	releases := newFakeReleaseServer(t)
	releases.publishRelease("16.10.2026", "")
	app, events := newUpdateApp(t, "release", "16.10.2026", releases)
	app.CheckForUpdate()

	if _, err := app.InstallUpdate(); err == nil || !strings.Contains(err.Error(), "no update to install") {
		t.Fatalf("wanted Install refused without an update, got %v", err)
	}
	if events.has(updateFailedEvent) {
		t.Fatalf("wanted no %s event, got %v", updateFailedEvent, events.names)
	}
}

func TestFailedInstallCanBeRetried(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, _ := newInstallApp(t, releases, keys)
	releases.fail(http.StatusBadGateway)
	if result, _ := app.InstallUpdate(); result.Outcome != InstallOutcomeFailed {
		t.Fatalf("wanted the first install to fail, got %+v", result)
	}
	releases.fail(0)

	result, err := app.InstallUpdate()

	if err != nil || result.Outcome != InstallOutcomeInstalled {
		t.Fatalf("wanted the retry installed, got %+v (%v)", result, err)
	}
	assertInstalled(t, app.installLocation, updateBinary)
	if state := app.GetUpdateState(); state.Failure != nil {
		t.Fatalf("wanted the earlier failure cleared, got %+v", state.Failure)
	}
}

// restartRecorder stands in for Wails quitting and for relaunching: quitting
// runs beforeClose and, unless it prevents the close, the shutdown, as
// runtime.Quit does.
type restartRecorder struct {
	quits      int
	prevented  []bool
	relaunched []string
}

func recordRestarts(app *App) *restartRecorder {
	recorder := &restartRecorder{}
	app.quitApp = func() {
		recorder.quits++
		prevent := app.beforeClose(context.Background())
		recorder.prevented = append(recorder.prevented, prevent)
		if !prevent {
			app.close(context.Background())
		}
	}
	app.relaunch = func(location string) error {
		recorder.relaunched = append(recorder.relaunched, location)
		return nil
	}
	return recorder
}

// newInstalledApp returns an App that has installed an update and waits for
// a restart.
func newInstalledApp(t *testing.T) (*App, *recordedEvents) {
	t.Helper()
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	if result, err := app.InstallUpdate(); err != nil || result.Outcome != InstallOutcomeInstalled {
		t.Fatalf("wanted the update installed, got %+v (%v)", result, err)
	}
	return app, events
}

func TestRestartNowWithNothingToLoseRelaunchesTheNewBuildAfterShutdown(t *testing.T) {
	app, _ := newInstalledApp(t)
	dialog := withDialog(app, "Cancel")
	restarts := recordRestarts(app)

	restarted, err := app.RestartToUpdate()

	if err != nil || !restarted {
		t.Fatalf("wanted Marasi to restart, got %v (%v)", restarted, err)
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no dialog with nothing to lose, got %+v", dialog.asked)
	}
	if restarts.quits != 1 || restarts.prevented[0] {
		t.Fatalf("wanted Marasi to quit once through the normal shutdown, got %+v", restarts)
	}
	if len(restarts.relaunched) != 1 || restarts.relaunched[0] != app.installLocation {
		t.Fatalf("wanted the build at %s relaunched once, got %v", app.installLocation, restarts.relaunched)
	}
}

func TestRestartNowWithUnsavedDraftsAsksOnceThenRelaunches(t *testing.T) {
	app, _ := newInstalledApp(t)
	app.SetUnsavedDraftCount(2)
	dialog := withDialog(app, "Restart Marasi")
	restarts := recordRestarts(app)

	restarted, err := app.RestartToUpdate()

	if err != nil || !restarted {
		t.Fatalf("wanted Marasi to restart, got %v (%v)", restarted, err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted the work-loss warning once, got %d dialogs", len(dialog.asked))
	}
	asked := dialog.asked[0]
	if asked.Title != "Restart Marasi" || !strings.Contains(asked.Message, "2 launchpads have unsaved drafts. Restart Marasi will discard them.") {
		t.Fatalf("wanted the usual warning for Restart Marasi, got %+v", asked)
	}
	if restarts.quits != 1 || restarts.prevented[0] || len(restarts.relaunched) != 1 {
		t.Fatalf("wanted one quit and one relaunch, got %+v", restarts)
	}
}

func TestCancellingTheRestartWarningKeepsTheRestartPending(t *testing.T) {
	app, _ := newInstalledApp(t)
	app.SetUnsavedDraftCount(1)
	dialog := withDialog(app, "Cancel")
	restarts := recordRestarts(app)

	restarted, err := app.RestartToUpdate()

	if err != nil || restarted {
		t.Fatalf("wanted Marasi to stay open, got %v (%v)", restarted, err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted the work-loss warning once, got %d dialogs", len(dialog.asked))
	}
	if restarts.quits != 0 || len(restarts.relaunched) != 0 {
		t.Fatalf("wanted no quit and no relaunch, got %+v", restarts)
	}
	if state := app.GetUpdateState(); state.Status != UpdateStatusRestartPending {
		t.Fatalf("wanted the restart still pending, got %+v", state)
	}
	// Closing Marasi later still warns about the drafts.
	if prevent := app.beforeClose(context.Background()); !prevent || len(dialog.asked) != 2 {
		t.Fatalf("wanted a later close to warn again, got prevent %v after %d dialogs", prevent, len(dialog.asked))
	}
}

func TestRestartWithoutAnInstalledUpdateIsRefused(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, _ := newInstallApp(t, releases, keys)
	restarts := recordRestarts(app)

	if _, err := app.RestartToUpdate(); err == nil {
		t.Fatal("wanted Restart refused before an update is installed")
	}
	if restarts.quits != 0 || len(restarts.relaunched) != 0 {
		t.Fatalf("wanted no quit and no relaunch, got %+v", restarts)
	}
}

func TestClosingMarasiWithARestartPendingDoesNotRelaunch(t *testing.T) {
	app, _ := newInstalledApp(t)
	restarts := recordRestarts(app)

	app.quitApp() // as the window's close button does

	if restarts.quits != 1 || restarts.prevented[0] || len(restarts.relaunched) != 0 {
		t.Fatalf("wanted a plain close to quit without relaunching, got %+v", restarts)
	}
}

func TestFailedInstallLeavesTheInstallUnchangedAndSaysWhatFailed(t *testing.T) {
	cases := []struct {
		name    string
		publish func(*fakeReleaseServer, signingKeys)
		kind    UpdateFailureKind
		step    InstallStep
		reason  string
	}{
		{"signed by another key", func(r *fakeReleaseServer, _ signingKeys) {
			publishSignedRelease(r, newSigningKeys(t), "17.10.2026", updateBinary)
		}, UpdateFailureSignature, InstallStepVerify, "not signed by the Marasi signing key"},
		{"checksums changed after signing", func(r *fakeReleaseServer, keys signingKeys) {
			signed := checksumsFor(map[string][]byte{"marasi-app": updateBinary})
			tampered := checksumsFor(map[string][]byte{"marasi-app": []byte("evil")})
			publishRelease(r, "17.10.2026", []byte("evil"), tampered, minisign.Sign(keys.private, signed))
		}, UpdateFailureSignature, InstallStepVerify, "not signed by the Marasi signing key"},
		{"no signature published", func(r *fakeReleaseServer, _ signingKeys) {
			publishRelease(r, "17.10.2026", updateBinary, checksumsFor(map[string][]byte{"marasi-app": updateBinary}), nil)
		}, UpdateFailureSignature, InstallStepVerify, "no signature"},
		{"build differs from its signed checksum", func(r *fakeReleaseServer, keys signingKeys) {
			checksums := checksumsFor(map[string][]byte{"marasi-app": updateBinary})
			publishRelease(r, "17.10.2026", []byte("corrupted"), checksums, minisign.Sign(keys.private, checksums))
		}, UpdateFailureChecksum, InstallStepVerify, "does not match its signed checksum"},
		{"build missing from the signed checksums", func(r *fakeReleaseServer, keys signingKeys) {
			checksums := checksumsFor(map[string][]byte{"marasi-app.exe": updateBinary})
			publishRelease(r, "17.10.2026", updateBinary, checksums, minisign.Sign(keys.private, checksums))
		}, UpdateFailureChecksum, InstallStepVerify, "do not list marasi-app"},
		{"no build for this platform", func(r *fakeReleaseServer, keys signingKeys) {
			checksums := checksumsFor(map[string][]byte{"marasi-app.exe": updateBinary})
			publishRelease(r, "17.10.2026", nil, checksums, minisign.Sign(keys.private, checksums))
			r.addAsset("17.10.2026", "marasi-app.exe", updateBinary)
		}, UpdateFailureNoBuild, InstallStepDownload, "this release has no build for your platform"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			releases := newFakeReleaseServer(t)
			keys := newSigningKeys(t)
			c.publish(releases, keys)
			app, events := newInstallApp(t, releases, keys)

			result, err := app.InstallUpdate()

			if err != nil {
				t.Fatalf("installing: %v", err)
			}
			assertFailed(t, app, events, result, c.kind, c.step, c.reason)
		})
	}
}

func TestInstallThatCannotDownloadIsANetworkFailure(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	releases.fail(http.StatusBadGateway)

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertFailed(t, app, events, result, UpdateFailureNetwork, InstallStepDownload, "502")
}

// unswappableInstaller is the Linux installer with a swap that always
// fails, as when the install location is replaced by something else mid
// install.
type unswappableInstaller struct{ binaryInstaller }

func (unswappableInstaller) swap(staged, location string) error {
	return fmt.Errorf("moving the new build into place: %w", os.ErrExist)
}

func TestAFailedReplacementStopsAtTheInstallStep(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	app.installer = unswappableInstaller{binaryInstaller{assetName: "marasi-app"}}

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertFailed(t, app, events, result, UpdateFailureInstall, InstallStepInstall, "moving the new build into place")
}

func TestAPlatformThatCannotReplaceItselfStopsAtTheInstallStepWithoutDownloading(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	app.installer = nil
	requests := releases.requestCount()

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertFailed(t, app, events, result, UpdateFailurePermissions, InstallStepInstall, "cannot replace itself on this platform")
	if releases.requestCount() != requests {
		t.Fatalf("wanted nothing downloaded, got %v", releases.requested())
	}
	if progressEvents(events) != nil {
		t.Fatalf("wanted no step reported before the failure, got %+v", progressEvents(events))
	}
	assertFoundBeforeDownloading(t, result)
}

// assertFoundBeforeDownloading fails unless the failed install says it was
// stopped by the check before anything downloads, so trying again won't help.
func assertFoundBeforeDownloading(t *testing.T, result UpdateInstall) {
	t.Helper()
	if !result.Failure.BeforeDownload {
		t.Fatalf("wanted the failure marked as found before anything downloaded, got %+v", result.Failure)
	}
}

// lockedOutInstaller is the Linux installer with a swap refused for lack of
// rights, as when the install directory turns read-only during the download.
type lockedOutInstaller struct{ binaryInstaller }

func (lockedOutInstaller) swap(staged, location string) error {
	return fmt.Errorf("renaming %s: %w", staged, os.ErrPermission)
}

func TestAPermissionErrorAfterTheDownloadStopsAtTheInstallStepAfterDownloading(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
	app, events := newInstallApp(t, releases, keys)
	app.installer = lockedOutInstaller{binaryInstaller{assetName: "marasi-app"}}

	result, err := app.InstallUpdate()

	if err != nil {
		t.Fatalf("installing: %v", err)
	}
	assertFailed(t, app, events, result, UpdateFailurePermissions, InstallStepInstall, "could not replace Marasi")
	if result.Failure.BeforeDownload {
		t.Fatalf("wanted a failure after the download not marked as found before it, got %+v", result.Failure)
	}
}

// assertFailed fails unless the install failed with kind at step, a reason
// containing reason and the release page, emitted it, and left the running
// build alone.
func assertFailed(t *testing.T, app *App, events *recordedEvents, result UpdateInstall, kind UpdateFailureKind, step InstallStep, reason string) {
	t.Helper()
	if result.Outcome != InstallOutcomeFailed || result.Failure == nil {
		t.Fatalf("wanted a failed install, got %+v", result)
	}
	failure := *result.Failure
	if failure.Kind != kind || !strings.Contains(failure.Reason, reason) {
		t.Fatalf("wanted a %s failure saying %q, got %s: %s", kind, reason, failure.Kind, failure.Reason)
	}
	if failure.Step != step {
		t.Fatalf("wanted the %s failure to stop at the %s step, got %q", kind, step, failure.Step)
	}
	if failure.ReleasePage != "https://github.com/tfkr-ae/marasi-app/releases/tag/17.10.2026" {
		t.Fatalf("wanted the failure to link the release page, got %q", failure.ReleasePage)
	}
	assertInstalled(t, app.installLocation, runningBinary)
	assertOnlyFile(t, app.installLocation)
	data, ok := events.first(updateFailedEvent)
	if !ok || len(data) != 1 || data[0] != failure {
		t.Fatalf("wanted one %s event carrying %+v, got %v", updateFailedEvent, failure, events.names)
	}
	if events.has(updateInstalledEvent) {
		t.Fatalf("wanted no %s event, got %v", updateInstalledEvent, events.names)
	}
	state := app.GetUpdateState()
	if state.Status != UpdateStatusFailed || state.Failure == nil || *state.Failure != failure || state.Update == nil {
		t.Fatalf("wanted the failed state to keep the update and the failure, got %+v", state)
	}
}

func TestCheckFindingANewerBuildWhileARestartIsPendingKeepsTheInstalledUpdate(t *testing.T) {
	for _, kind := range []checkKind{checkManual, checkAutomatic} {
		releases := newFakeReleaseServer(t)
		keys := newSigningKeys(t)
		publishSignedRelease(releases, keys, "17.10.2026", updateBinary)
		app, _ := newInstallApp(t, releases, keys)
		if result, err := app.InstallUpdate(); err != nil || result.Outcome != InstallOutcomeInstalled {
			t.Fatalf("wanted the update installed, got %+v (%v)", result, err)
		}
		publishSignedRelease(releases, keys, "18.10.2026", updateBinary)
		events := &recordedEvents{}
		app.emitEvent = events.emit

		app.checkForUpdate(context.Background(), kind)

		if events.has(updateAvailableEvent) {
			t.Fatalf("wanted no %s while a restart is pending, got %v", updateAvailableEvent, events.names)
		}
		if state := app.GetUpdateState(); state.Status != UpdateStatusRestartPending || state.Update.Version != "17.10.2026" {
			t.Fatalf("wanted 17.10.2026 still pending a restart, got %q %+v", state.Status, state.Update)
		}
	}
}
