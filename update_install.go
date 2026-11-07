package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Installing an update (spec "Trust", "Replacement", "Relaunch"). The
// pipeline is shared by every platform:
//
//  1. check the build can update itself: a signing key, a platform installer
//     and a writable install location (platformInstaller.checkReplaceable);
//  2. download checksums.txt and checksums.txt.minisig and verify the
//     signature against App.signingKey (docs/adr/2026-10-17-updates-are-signed-with-an-embedded-key.md);
//  3. download the platform's asset (platformInstaller.asset) to a temp
//     directory, with progress events, and compare its SHA-256 with the
//     signed checksums;
//  4. hand the verified download to the platform: stage it next to the
//     install location (unpacking and any platform check, such as the macOS
//     team check), then swap it in as one step;
//  5. offer a restart, which relaunches through App.relaunch during the
//     normal shutdown.
//
// A failure at any step discards what was downloaded or staged, leaving the
// install location as it was.
//
// The researcher sees three of these as the install's steps (InstallStep):
// download (2 and 3's downloads), verify (the checksum compare and the
// platform's checks in stage) and install (the rest of stage and the swap).
// Each step is reported in UpdateState.Progress and an update-progress event
// as it starts, and a failure records the step it stopped at.

// Release assets every release and nightly publishes beside the builds.
const (
	checksumsAsset = "checksums.txt"
	signatureAsset = "checksums.txt.minisig"
)

// Size limits for what an install downloads.
const (
	maxChecksumsSize = 64 << 10
	maxBuildSize     = 1 << 30
)

// Events sent to the frontend while installing.
const (
	// updateProgressEvent carries an UpdateProgress while the build
	// downloads, and again as each later step starts.
	updateProgressEvent = "update-progress"
	// updateInstalledEvent carries the Update now on disk, pending a restart.
	updateInstalledEvent = "update-installed"
	// updateFailedEvent carries the UpdateFailure that stopped an install.
	updateFailedEvent = "update-failed"
)

// platformInstaller is the part of an install that differs per platform. The
// shared pipeline downloads and verifies; the installer turns the verified
// download into the installed build. Each platform's default is chosen in
// update_platform_<goos>.go.
type platformInstaller interface {
	// asset is the release asset this platform installs, such as
	// "marasi-app" on Linux.
	asset() string
	// locate returns the install location for the running executable: the
	// file or bundle an install replaces.
	locate(executable string) (string, error)
	// checkReplaceable reports why the build at location cannot be replaced
	// without elevated rights, or nil when it can. The error is shown to the
	// researcher as is.
	checkReplaceable(location string) error
	// stage turns download, a verified copy of asset in a temp directory,
	// into a replacement beside location, and returns its path. Platform
	// checks of the new build (the macOS team check) belong here, before
	// stage calls verified, which moves the install from the verify step to
	// the install step; return an *installError to give their failure its
	// own kind. On failure stage removes what it created.
	stage(download, location string, verified func()) (string, error)
	// swap replaces location with staged in one step. On failure location
	// is unchanged.
	swap(staged, location string) error
	// relaunch starts the build installed at location. It is called while
	// the app shuts down, after the project and listener are released.
	relaunch(location string) error
}

// InstallOutcome is how InstallUpdate ended.
type InstallOutcome string

const (
	// InstallOutcomeInstalled: the update is on disk; a restart runs it.
	InstallOutcomeInstalled InstallOutcome = "installed"
	// InstallOutcomeFailed: the install location is unchanged;
	// UpdateInstall.Failure says why.
	InstallOutcomeFailed InstallOutcome = "failed"
	// InstallOutcomeCancelled: the researcher cancelled the download.
	InstallOutcomeCancelled InstallOutcome = "cancelled"
)

// InstallStep is the step an install is on, or stopped at when it failed.
type InstallStep string

const (
	// InstallStepDownload: downloading checksums.txt, its signature and the
	// build. A Marasi that cannot download (network) or finds no build for
	// its platform (no-build) stops here.
	InstallStepDownload InstallStep = "download"
	// InstallStepVerify: checking the signature, the checksum and, on macOS,
	// the developer team. Signature, checksum and team failures stop here.
	InstallStepVerify InstallStep = "verify"
	// InstallStepInstall: replacing the build at the install location. A
	// Marasi that cannot replace itself stops here, though that is found
	// out before anything downloads.
	InstallStepInstall InstallStep = "install"
)

// failureStep is the step a failed install is reported at. The first that
// applies decides:
//  1. a network, signature, checksum or team failure stops at its own step
//     wherever it is found (a missing signing key, or a bad signature
//     checked before the build downloads, still stops at verify);
//  2. a build that cannot install updates, found before anything downloads
//     (beforeDownload), stops at install, where it would fail;
//  3. any other failure stops at the step running when it occurred.
func failureStep(kind UpdateFailureKind, beforeDownload bool, running InstallStep) InstallStep {
	switch kind {
	case UpdateFailureNetwork:
		return InstallStepDownload
	case UpdateFailureSignature, UpdateFailureChecksum, UpdateFailureTeam:
		return InstallStepVerify
	}
	if beforeDownload {
		return InstallStepInstall
	}
	return running
}

// UpdateFailureKind is what an install failed at, so the panel can say
// plainly what failed.
type UpdateFailureKind string

const (
	// UpdateFailureNetwork: a download did not complete.
	UpdateFailureNetwork UpdateFailureKind = "network"
	// UpdateFailureNoBuild: the release publishes no build for this
	// platform; it can only be installed by hand, if at all.
	UpdateFailureNoBuild UpdateFailureKind = "no-build"
	// UpdateFailureSignature: checksums.txt is not signed by the Marasi
	// signing key, or this build has no key to check it with.
	UpdateFailureSignature UpdateFailureKind = "signature"
	// UpdateFailureChecksum: the build does not match its signed checksum.
	UpdateFailureChecksum UpdateFailureKind = "checksum"
	// UpdateFailureTeam: the new macOS app is not signed by the same Apple
	// developer team as the running one.
	UpdateFailureTeam UpdateFailureKind = "team"
	// UpdateFailurePermissions: the app cannot write to its install location.
	UpdateFailurePermissions UpdateFailureKind = "permissions"
	// UpdateFailureInstall: staging or swapping in the new build failed.
	UpdateFailureInstall UpdateFailureKind = "install"
)

// UpdateFailure says why an install failed.
type UpdateFailure struct {
	Kind UpdateFailureKind
	// Step is the step the install stopped at.
	Step InstallStep
	// Reason is in words a researcher can act on.
	Reason string
	// ReleasePage is where the build can be installed by hand.
	ReleasePage string
	// BeforeDownload: the check that this build can install updates at all
	// (a signing key, a platform installer, a writable install location)
	// stopped the install before anything downloaded, as CanInstall reports
	// in UpdateState. Trying again cannot help until that changes.
	BeforeDownload bool
}

// UpdateProgress is the step a running install is on and how far the
// build's download has got. Total is 0 when the size is unknown. Once the
// download is done, Received and Total keep its size through the later
// steps.
type UpdateProgress struct {
	Step     InstallStep
	Received int64
	Total    int64
}

// UpdateInstall is the result of InstallUpdate.
type UpdateInstall struct {
	Outcome InstallOutcome
	// Update is the update the install was for.
	Update *Update
	// Failure is set when Outcome is failed.
	Failure *UpdateFailure
}

// installError is a failed install step and its kind. beforeDownload marks
// a failure of the check that this build can install updates
// (App.replaceable).
type installError struct {
	kind           UpdateFailureKind
	beforeDownload bool
	err            error
}

func (e *installError) Error() string { return e.err.Error() }
func (e *installError) Unwrap() error { return e.err }

func failed(kind UpdateFailureKind, format string, args ...any) error {
	return &installError{kind: kind, err: fmt.Errorf(format, args...)}
}

// errCancelled reports a download the researcher cancelled.
var errCancelled = errors.New("the download was cancelled")

// InstallUpdate downloads, verifies and installs the known update. Progress
// and the outcome are also emitted as events. It returns an error, rather
// than a failed install, when there is nothing to install or an install is
// already running.
func (a *App) InstallUpdate() (UpdateInstall, error) {
	update, ctx, err := a.startInstall(nil)
	if err != nil {
		return UpdateInstall{}, err
	}
	err = a.install(ctx, update)
	return a.finishInstall(ctx, update, err), nil
}

// CancelUpdateDownload aborts a running download. The known update stays
// available. It does nothing when no download is running, or once the
// download is done and the build is being verified or swapped in.
func (a *App) CancelUpdateDownload() {
	a.updates.cancel()
}

// cancel aborts the running download, if any.
func (u *updater) cancel() {
	u.mu.Lock()
	cancel := u.cancelDownload
	u.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// RestartToUpdate is "Restart now" after an install. It gives the usual
// warning about unsaved Launchpad drafts and active Armory runs; when the
// researcher confirms, Marasi quits through the normal shutdown, which then
// relaunches the installed build. It reports whether Marasi is restarting:
// false when the researcher cancelled, which leaves the restart pending.
func (a *App) RestartToUpdate() (bool, error) {
	if !a.updates.is(UpdateStatusRestartPending) {
		return false, errors.New("no installed update is waiting for a restart")
	}
	confirmed, err := a.confirmLosingWork("Restart Marasi")
	if err != nil || !confirmed {
		return false, err
	}
	a.restarting.Store(true)
	a.quitApp()
	return true, nil
}

// relaunchIfRestarting starts the installed build when the app is shutting
// down for "Restart now". close calls it last, once the project and listener
// are released.
func (a *App) relaunchIfRestarting() {
	if !a.restarting.Load() {
		return
	}
	if err := a.relaunch(a.installLocation); err != nil {
		log.Printf("relaunching the installed update: %v", err)
	}
}

// is reports whether the update state is status.
func (u *updater) is(status UpdateStatus) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status == status
}

// busy reports why no install can start now: one is running or waits for a
// restart. Callers hold mu.
func (u *updater) busy() error {
	switch u.status {
	case UpdateStatusDownloading:
		return errors.New("an update is already being installed")
	case UpdateStatusRestartPending:
		return errors.New("an update is already installed; restart Marasi to run it")
	}
	return nil
}

// installBusy reports why no install can start now, or nil.
func (a *App) installBusy() error {
	a.updates.mu.Lock()
	defer a.updates.mu.Unlock()
	return a.updates.busy()
}

// startInstall moves the update to install to downloading and returns it
// with the context the install runs under. The update is target when given
// (a reinstall, which replaces any known update), else the known update.
func (a *App) startInstall(target *Update) (*Update, context.Context, error) {
	if a.updateChannel() == "" {
		return nil, nil, errUpdatesUnavailable
	}
	a.updates.mu.Lock()
	defer a.updates.mu.Unlock()
	if err := a.updates.busy(); err != nil {
		return nil, nil, err
	}
	if target == nil && a.updates.status != UpdateStatusAvailable && a.updates.status != UpdateStatusFailed {
		return nil, nil, errors.New("there is no update to install")
	}
	if target != nil {
		a.updates.update = target
	}
	if a.updates.update == nil {
		return nil, nil, errors.New("there is no update to install")
	}
	ctx, cancel := context.WithCancel(a.updateContext())
	a.updates.status = UpdateStatusDownloading
	a.updates.cancelDownload = cancel
	a.updates.progress = &UpdateProgress{Step: InstallStepDownload}
	a.updates.failure = nil
	return a.updates.update, ctx, nil
}

// finishInstall records how the install of update ended and emits it.
func (a *App) finishInstall(ctx context.Context, update *Update, err error) UpdateInstall {
	result := UpdateInstall{Update: update}
	a.updates.mu.Lock()
	if a.updates.cancelDownload != nil {
		a.updates.cancelDownload()
		a.updates.cancelDownload = nil
	}
	running := InstallStepDownload
	if a.updates.progress != nil {
		running = a.updates.progress.Step
	}
	a.updates.progress = nil
	switch {
	case err == nil:
		result.Outcome = InstallOutcomeInstalled
		a.updates.status = UpdateStatusRestartPending
	case errors.Is(err, errCancelled):
		result.Outcome = InstallOutcomeCancelled
		a.updates.status = UpdateStatusAvailable
	default:
		result.Outcome = InstallOutcomeFailed
		failure := UpdateFailure{Kind: UpdateFailureInstall, Reason: err.Error(), ReleasePage: update.ReleasePage}
		var stepErr *installError
		if errors.As(err, &stepErr) {
			failure.Kind = stepErr.kind
			failure.BeforeDownload = stepErr.beforeDownload
		}
		failure.Step = failureStep(failure.Kind, failure.BeforeDownload, running)
		result.Failure = &failure
		a.updates.status = UpdateStatusFailed
		a.updates.failure = result.Failure
	}
	a.updates.mu.Unlock()

	switch result.Outcome {
	case InstallOutcomeInstalled:
		a.emitEvent(updateInstalledEvent, *update)
	case InstallOutcomeFailed:
		log.Printf("installing update %s: %s", update.Version, result.Failure.Reason)
		a.emitEvent(updateFailedEvent, *result.Failure)
	}
	return result
}

// install runs the pipeline for update. Its error is an *installError, or
// wraps errCancelled.
func (a *App) install(ctx context.Context, update *Update) error {
	installer, location, err := a.replaceable()
	if err != nil {
		return err
	}
	release := update.release
	checksumsURL, ok := release.asset(checksumsAsset)
	if !ok {
		return failed(UpdateFailureSignature, "the release has no %s to verify the build with", checksumsAsset)
	}
	signatureURL, ok := release.asset(signatureAsset)
	if !ok {
		return failed(UpdateFailureSignature, "the release has no signature (%s)", signatureAsset)
	}
	build, ok := release.asset(installer.asset())
	if !ok {
		return failed(UpdateFailureNoBuild, "this release has no build for your platform (%s)", installer.asset())
	}

	checksums, err := a.downloadSmall(ctx, checksumsURL)
	if err != nil {
		return err
	}
	signature, err := a.downloadSmall(ctx, signatureURL)
	if err != nil {
		return err
	}
	// The signed checksums are checked before the build downloads, so a bad
	// signature wastes no download. It is instant, so the install shows the
	// verify step only once the build is in; a failure here still stops at
	// verify (failureStep).
	sums, err := verifyChecksums(*a.signingKey, checksums, signature)
	if err != nil {
		return err
	}
	want, ok := sums[installer.asset()]
	if !ok {
		return failed(UpdateFailureChecksum, "the signed checksums do not list %s", installer.asset())
	}

	dir, err := os.MkdirTemp("", "marasi-update-")
	if err != nil {
		return failed(UpdateFailureInstall, "could not make room for the download: %w", err)
	}
	defer os.RemoveAll(dir)
	download := filepath.Join(dir, installer.asset())
	got, err := a.downloadBuild(ctx, build, download)
	if err != nil {
		return err
	}
	a.enterStep(InstallStepVerify)
	if got != want {
		return failed(UpdateFailureChecksum, "the downloaded %s does not match its signed checksum", installer.asset())
	}
	if ctx.Err() != nil {
		return errCancelled
	}

	staged, err := installer.stage(download, location, func() { a.enterStep(InstallStepInstall) })
	if err != nil {
		return asInstallError(err, "could not prepare the new build")
	}
	if err := installer.swap(staged, location); err != nil {
		_ = os.RemoveAll(staged)
		return asInstallError(err, "could not replace Marasi")
	}
	return nil
}

// replaceable returns the installer and install location when this build
// can replace itself, or the *installError saying why it cannot.
func (a *App) replaceable() (platformInstaller, string, error) {
	switch {
	case a.signingKey == nil:
		return nil, "", foundBeforeDownload(failed(UpdateFailureSignature, "this build has no Marasi signing key to verify updates with"))
	case a.installer == nil:
		return nil, "", foundBeforeDownload(failed(UpdateFailurePermissions, "Marasi cannot replace itself on this platform"))
	case a.installLocation == "":
		return nil, "", foundBeforeDownload(failed(UpdateFailurePermissions, "Marasi could not find where it is installed"))
	}
	if err := a.installer.checkReplaceable(a.installLocation); err != nil {
		return nil, "", foundBeforeDownload(asInstallError(err, "Marasi cannot replace itself"))
	}
	return a.installer, a.installLocation, nil
}

// foundBeforeDownload marks err, an *installError, as found by the check
// that this build can install updates, before anything downloads.
func foundBeforeDownload(err error) error {
	var stepErr *installError
	if errors.As(err, &stepErr) {
		stepErr.beforeDownload = true
	}
	return err
}

// asInstallError keeps an installer's own failure kind, and otherwise calls a
// permission error a permissions failure and anything else an install
// failure.
func asInstallError(err error, doing string) error {
	var stepErr *installError
	if errors.As(err, &stepErr) {
		return err
	}
	if errors.Is(err, os.ErrPermission) {
		return failed(UpdateFailurePermissions, "%s: %w", doing, err)
	}
	return failed(UpdateFailureInstall, "%s: %w", doing, err)
}

// downloadSmall fetches a small release asset, such as checksums.txt.
func (a *App) downloadSmall(ctx context.Context, asset releaseAsset) ([]byte, error) {
	res, err := a.getAsset(ctx, asset)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxChecksumsSize+1))
	if err != nil {
		return nil, downloadError(ctx, asset, err)
	}
	if len(data) > maxChecksumsSize {
		return nil, failed(UpdateFailureNetwork, "%s is larger than expected", asset.Name)
	}
	return data, nil
}

// downloadBuild fetches the build into path, emitting progress, and returns
// its SHA-256 in hex.
func (a *App) downloadBuild(ctx context.Context, asset releaseAsset, path string) (string, error) {
	res, err := a.getAsset(ctx, asset)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	total := res.ContentLength
	if total < 0 {
		total = asset.Size
	}
	if total > maxBuildSize {
		return "", failed(UpdateFailureNetwork, "%s is larger than expected", asset.Name)
	}
	file, err := os.Create(path)
	if err != nil {
		return "", failed(UpdateFailureInstall, "could not save the download: %w", err)
	}
	defer file.Close()

	progress := newProgressReporter(total, a.reportProgress)
	sum, err := copyHashing(file, io.LimitReader(res.Body, maxBuildSize), progress)
	if err != nil {
		return "", downloadError(ctx, asset, err)
	}
	progress.done()
	return sum, nil
}

// getAsset starts the download of asset through the update client.
func (a *App) getAsset(ctx context.Context, asset releaseAsset) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if err != nil {
		return nil, failed(UpdateFailureNetwork, "the release lists a bad address for %s", asset.Name)
	}
	req.Header.Set("User-Agent", "marasi-app")
	res, err := a.updateHTTPClient().Do(req)
	if err != nil {
		return nil, downloadError(ctx, asset, unwrapURLError(err))
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, failed(UpdateFailureNetwork, "downloading %s: GitHub answered %s", asset.Name, res.Status)
	}
	return res, nil
}

// downloadError is a failed download of asset, or errCancelled when the
// researcher cancelled it.
func downloadError(ctx context.Context, asset releaseAsset, err error) error {
	if ctx.Err() != nil {
		return errCancelled
	}
	return failed(UpdateFailureNetwork, "could not download %s: %w", asset.Name, err)
}

// reportProgress records and emits how far the download has got.
func (a *App) reportProgress(progress UpdateProgress) {
	progress.Step = InstallStepDownload
	a.updates.setProgress(progress)
	a.emitEvent(updateProgressEvent, progress)
}

// enterStep records and emits that the install has moved on to step. It
// does nothing when the install is already on step.
func (a *App) enterStep(step InstallStep) {
	a.updates.mu.Lock()
	if a.updates.status != UpdateStatusDownloading || a.updates.progress == nil || a.updates.progress.Step == step {
		a.updates.mu.Unlock()
		return
	}
	progress := *a.updates.progress
	progress.Step = step
	a.updates.progress = &progress
	a.updates.mu.Unlock()
	a.emitEvent(updateProgressEvent, progress)
}

// setProgress records how far the download has got, while one runs.
func (u *updater) setProgress(progress UpdateProgress) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.status == UpdateStatusDownloading {
		u.progress = &progress
	}
}

// installability reports whether the panel can offer Install, and why not.
func (a *App) installability() (bool, string) {
	if _, _, err := a.replaceable(); err != nil {
		return false, err.Error()
	}
	return true, ""
}

// resolveInstallLocation is where the running build is installed, or "" when
// it cannot be found.
func resolveInstallLocation(installer platformInstaller) string {
	if installer == nil {
		return ""
	}
	executable, err := os.Executable()
	if err != nil {
		log.Printf("finding the running executable: %v", err)
		return ""
	}
	location, err := installer.locate(executable)
	if err != nil {
		log.Printf("finding where Marasi is installed: %v", err)
		return ""
	}
	return location
}

// leftoverRemover is a platformInstaller whose install leaves the previous
// version beside the install location until the next launch: Windows, which
// cannot delete the .exe that is running.
type leftoverRemover interface {
	removeLeftovers(location string) error
}

// removeUpdateLeftovers deletes what the last install left beside the
// install location. startup runs it in the background on every launch.
func (a *App) removeUpdateLeftovers() {
	remover, ok := a.installer.(leftoverRemover)
	if !ok || a.installLocation == "" {
		return
	}
	err := retryRemoval(func() error { return remover.removeLeftovers(a.installLocation) }, time.Sleep)
	if err != nil {
		log.Printf("removing the previous version left by an update: %v", err)
	}
}
