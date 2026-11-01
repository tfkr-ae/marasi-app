package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// releaseBinary is the latest release a reinstall puts back.
var releaseBinary = []byte("#!/bin/sh\necho marasi 16.10.2026\n")

// newNightlyInstallApp returns an App running nightly 17.10.2026 on Linux
// from a temp install directory, trusting keys, with no update known.
func newNightlyInstallApp(t *testing.T, releases *fakeReleaseServer, keys signingKeys) (*App, *recordedEvents) {
	t.Helper()
	app, events := newUpdateApp(t, "nightly", "17.10.2026 (nightly abc1234)", releases)
	app.installLocation = filepath.Join(t.TempDir(), "marasi-app")
	if err := os.WriteFile(app.installLocation, runningBinary, 0o755); err != nil {
		t.Fatalf("writing the running build: %v", err)
	}
	app.installer = binaryInstaller{assetName: "marasi-app"}
	app.signingKey = &keys.public
	return app, events
}

func TestReinstallingTheLatestReleaseWarnsThenInstallsItForARestart(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "16.10.2026", releaseBinary)
	app, events := newNightlyInstallApp(t, releases, keys)
	dialog := withDialog(app, "Reinstall latest release")

	result, err := app.ReinstallLatestRelease()

	if err != nil {
		t.Fatalf("reinstalling: %v", err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one warning, got %+v", dialog.asked)
	}
	warning := dialog.asked[0]
	if warning.Type != runtime.WarningDialog || warning.Title != "Reinstall latest release" {
		t.Fatalf("wanted a Reinstall latest release warning, got %+v", warning)
	}
	for _, want := range []string{"16.10.2026", "Projects opened in a newer build"} {
		if !strings.Contains(warning.Message, want) {
			t.Fatalf("wanted the warning to mention %q, got %q", want, warning.Message)
		}
	}
	if result.Outcome != InstallOutcomeInstalled || result.Update.Version != "16.10.2026" || result.Update.Channel != "release" {
		t.Fatalf("wanted release 16.10.2026 installed, got %+v", result)
	}
	assertInstalled(t, app.installLocation, releaseBinary)
	assertOnlyFile(t, app.installLocation)
	if !events.has(updateInstalledEvent) {
		t.Fatalf("wanted %s emitted, got %v", updateInstalledEvent, events.names)
	}
	if state := app.GetUpdateState(); state.Status != UpdateStatusRestartPending || state.Update.Version != "16.10.2026" {
		t.Fatalf("wanted release 16.10.2026 pending a restart, got %q %+v", state.Status, state.Update)
	}

	restarts := recordRestarts(app)
	if restarted, err := app.RestartToUpdate(); err != nil || !restarted {
		t.Fatalf("wanted Restart now to restart, got %v (%v)", restarted, err)
	}
	if len(restarts.relaunched) != 1 || restarts.relaunched[0] != app.installLocation {
		t.Fatalf("wanted the reinstalled build relaunched, got %v", restarts.relaunched)
	}
}

func TestCancellingTheReinstallWarningLeavesTheInstallUntouched(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "16.10.2026", releaseBinary)
	app, events := newNightlyInstallApp(t, releases, keys)
	dialog := withDialog(app, "Cancel")

	result, err := app.ReinstallLatestRelease()

	if err != nil {
		t.Fatalf("reinstalling: %v", err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted the warning shown, got %+v", dialog.asked)
	}
	if result.Outcome != InstallOutcomeCancelled {
		t.Fatalf("wanted the reinstall cancelled, got %+v", result)
	}
	assertInstalled(t, app.installLocation, runningBinary)
	for _, request := range releases.requested() {
		if strings.Contains(request, "/download/") {
			t.Fatalf("wanted nothing downloaded, got %v", releases.requested())
		}
	}
	if len(events.names) != 0 {
		t.Fatalf("wanted no events, got %v", events.names)
	}
	if state := app.GetUpdateState(); state.Status != UpdateStatusIdle {
		t.Fatalf("wanted no update known, got %q", state.Status)
	}
}

func TestReinstallWithNoReleasePublishedSaysWhyWithoutWarning(t *testing.T) {
	releases := newFakeReleaseServer(t)
	app, _ := newNightlyInstallApp(t, releases, newSigningKeys(t))
	dialog := withDialog(app, "Reinstall latest release")

	_, err := app.ReinstallLatestRelease()

	if err == nil || !strings.Contains(err.Error(), "no release is published") {
		t.Fatalf("wanted the missing release reported, got %v", err)
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no warning, got %+v", dialog.asked)
	}
}

func TestReinstallWhileAnUpdateWaitsForARestartIsRefusedWithoutWarning(t *testing.T) {
	app, _ := newInstalledApp(t)
	dialog := withDialog(app, "Reinstall latest release")

	if _, err := app.ReinstallLatestRelease(); err == nil {
		t.Fatalf("wanted the reinstall refused while a restart is pending")
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no warning, got %+v", dialog.asked)
	}
	assertInstalled(t, app.installLocation, updateBinary)
	if state := app.GetUpdateState(); state.Status != UpdateStatusRestartPending {
		t.Fatalf("wanted the restart still pending, got %q", state.Status)
	}
}

func TestReinstallingTheLatestReleaseFollowsTheReleaseChannelAfterTheRestart(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "16.10.2026", releaseBinary)
	app, _ := newNightlyInstallApp(t, releases, keys)
	if _, err := app.SetUpdateChannel("nightly"); err != nil {
		t.Fatalf("choosing nightly: %v", err)
	}
	withDialog(app, "Reinstall latest release")

	if result, err := app.ReinstallLatestRelease(); err != nil || result.Outcome != InstallOutcomeInstalled {
		t.Fatalf("wanted the release reinstalled, got %+v (%v)", result, err)
	}

	if got := app.GetUpdateSettings().Channel; got != "release" {
		t.Fatalf("wanted the channel release once reinstalled, got %q", got)
	}
	restarted, _ := restartedUpdateApp(t, app)
	restarted.build = BuildInfo{Channel: "release", Version: "16.10.2026"}
	if got := restarted.GetUpdateState().Channel; got != "release" {
		t.Fatalf("wanted the reinstalled release to follow the release channel, got %q", got)
	}
}

func TestCancelledReinstallKeepsTheChannel(t *testing.T) {
	releases := newFakeReleaseServer(t)
	keys := newSigningKeys(t)
	publishSignedRelease(releases, keys, "16.10.2026", releaseBinary)
	app, _ := newNightlyInstallApp(t, releases, keys)
	withDialog(app, "Cancel")

	if result, err := app.ReinstallLatestRelease(); err != nil || result.Outcome != InstallOutcomeCancelled {
		t.Fatalf("wanted the reinstall cancelled, got %+v (%v)", result, err)
	}

	if got := app.GetUpdateSettings().Channel; got != "nightly" {
		t.Fatalf("wanted the channel still nightly, got %q", got)
	}
}
