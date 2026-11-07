package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"aead.dev/minisign"
)

// Installing and updating the Marasi CLI from Marasi's GitHub releases
// (spec "CLI install and update"). checksums.txt.minisig must verify with
// marasiCLIPublicKey and its trusted comment must name the Marasi CLI, the
// channel and the release's version; the build must match its signed
// checksum. Anything else fails closed: nothing is written to the install
// folder and nothing is saved.

// cliInstallTimeout bounds a whole install or update.
const cliInstallTimeout = 10 * time.Minute

// cliSmallAssetLimit caps checksums.txt and its signature.
const cliSmallAssetLimit = 64 << 10

// cliAssets is the release asset of the CLI for each GOOS/GOARCH Marasi
// publishes (Marasi's release.yml and nightly.yml).
var cliAssets = map[string]string{
	"darwin/arm64":  "marasi-darwin-arm64",
	"linux/amd64":   "marasi-linux-amd64",
	"windows/amd64": "marasi-windows-amd64.exe",
}

// Outcomes of InstallCLI and CheckForCLIUpdate.
const (
	cliOutcomeInstalled = "installed"
	cliOutcomeUpToDate  = "up-to-date"
	// cliOutcomeDev: the CLI is a development build, which is never
	// replaced.
	cliOutcomeDev    = "dev"
	cliOutcomeFailed = "failed"
)

const (
	cliNoBuildReason        = "No Marasi CLI build for this platform"
	cliNightlyMissingReason = "Nightly release unavailable, try again shortly"
)

// CLIFailure says why a CLI install failed.
type CLIFailure struct {
	// Kind is what failed: network, no-build, signature, checksum or install.
	Kind string `json:"kind"`
	// Reason is in words a researcher can act on.
	Reason string `json:"reason"`
}

// CLIInstall is the result of InstallCLI and CheckForCLIUpdate.
type CLIInstall struct {
	// Outcome is installed, up-to-date, dev or failed.
	Outcome string `json:"outcome"`
	// Version and Channel are the release checked or installed.
	Version string `json:"version"`
	Channel string `json:"channel"`
	// CLI is the CLI the app uses afterwards.
	CLI CLIInfo `json:"cli"`
	// Failure is set when Outcome is failed.
	Failure *CLIFailure `json:"failure"`
}

// cliInstallProgressEvent reports a running CLI install or update to the
// frontend, with a CLIInstallProgress.
const cliInstallProgressEvent = "cli-install-progress"

// CLIInstallProgress is the step a CLI install is on: download (with the
// bytes received and the total, 0 when the server didn't say), verify or
// install.
type CLIInstallProgress struct {
	Step     string `json:"step"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
}

func (a *App) reportCLIProgress(progress CLIInstallProgress) {
	a.emitEvent(cliInstallProgressEvent, progress)
}

// CLIChannel is the CLI's channel: Setting is "app" (follow the app),
// "release" or "nightly"; Effective is the channel installs use.
type CLIChannel struct {
	Setting   string `json:"setting"`
	Effective string `json:"effective"`
}

// GetCLIChannel reports the CLI channel.
func (a *App) GetCLIChannel() CLIChannel {
	setting := "app"
	if a.Config != nil {
		if saved := a.Config.cliChannelSetting(); saved != "" {
			setting = string(saved)
		}
	}
	return CLIChannel{Setting: setting, Effective: string(a.cliChannel())}
}

// SetCLIChannel saves the CLI channel: "app" follows the app's channel,
// "release" or "nightly" overrides it.
func (a *App) SetCLIChannel(setting string) (CLIChannel, error) {
	channel := Channel(setting)
	switch {
	case setting == "app":
		channel = ""
	case !channel.valid():
		return a.GetCLIChannel(), fmt.Errorf("%q isn't a CLI channel", setting)
	}
	if err := a.Config.setCLIChannel(channel); err != nil {
		return a.GetCLIChannel(), err
	}
	return a.GetCLIChannel(), nil
}

// cliChannel is the channel CLI installs use: the saved override, else the
// app's build channel, else release (for a development app).
func (a *App) cliChannel() Channel {
	if a.Config != nil {
		if saved := a.Config.cliChannelSetting(); saved != "" {
			return saved
		}
	}
	if build := Channel(a.build.Channel); build.valid() {
		return build
	}
	return channelRelease
}

// InstallCLI installs the Marasi CLI for this platform from the release on
// the CLI's channel into dir, and saves it as the app's CLI. It returns an
// error, rather than a failed install, only when dir is empty.
func (a *App) InstallCLI(dir string) (CLIInstall, error) {
	dir, err := a.expandCLIDir(dir)
	if err != nil {
		return CLIInstall{}, err
	}
	r := &a.cliRuntime
	r.mu.Lock()
	defer r.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), cliInstallTimeout)
	defer cancel()

	channel := a.cliChannel()
	result := CLIInstall{Channel: string(channel)}
	target := filepath.Join(dir, cliFileName(r.goos))
	release, version, err := a.findCLIRelease(ctx, channel)
	if err == nil {
		result.Version = version
		err = a.installCLIRelease(ctx, release, channel, version, target)
	}
	if err == nil {
		err = a.Config.setCLIPath(savedCLIPath{Path: target, Source: cliSourceInstalled})
	}
	if err != nil {
		return a.cliFailed(result, err), nil
	}
	result.Outcome = cliOutcomeInstalled
	result.CLI, _ = a.LocateCLI()
	return result, nil
}

// CheckForCLIUpdate replaces the CLI the app uses with the release on the
// CLI's channel when that differs from it. A development build is left
// alone. It returns an error when there is no CLI.
func (a *App) CheckForCLIUpdate() (CLIInstall, error) {
	current, err := a.LocateCLI()
	if err != nil {
		return CLIInstall{}, err
	}
	if !current.Found {
		return CLIInstall{}, errNoCLI
	}
	r := &a.cliRuntime
	r.mu.Lock()
	defer r.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), cliInstallTimeout)
	defer cancel()

	channel := a.cliChannel()
	result := CLIInstall{Channel: string(channel), CLI: current}
	if current.Version == "dev" || current.Version == "" {
		result.Outcome = cliOutcomeDev
		return result, nil
	}
	release, version, err := a.findCLIRelease(ctx, channel)
	if err != nil {
		return a.cliFailed(result, err), nil
	}
	result.Version = version
	if current.Version == version && current.Channel == string(channel) {
		result.Outcome = cliOutcomeUpToDate
		return result, nil
	}
	if err := a.installCLIRelease(ctx, release, channel, version, current.Path); err != nil {
		return a.cliFailed(result, err), nil
	}
	result.Outcome = cliOutcomeInstalled
	result.CLI, _ = a.LocateCLI()
	return result, nil
}

func (a *App) cliFailed(result CLIInstall, err error) CLIInstall {
	failure := CLIFailure{Kind: string(UpdateFailureInstall), Reason: err.Error()}
	var stepErr *installError
	if errors.As(err, &stepErr) {
		failure.Kind = string(stepErr.kind)
	}
	result.Outcome = cliOutcomeFailed
	result.Failure = &failure
	return result
}

// expandCLIDir trims dir and expands a leading ~.
func (a *App) expandCLIDir(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", errors.New("choose a folder to install the Marasi CLI in")
	}
	if dir == "~" || strings.HasPrefix(dir, "~/") || strings.HasPrefix(dir, `~\`) {
		home, err := a.cliRuntime.homeDir()
		if err != nil {
			return "", fmt.Errorf("finding your home folder: %w", err)
		}
		dir = filepath.Join(home, dir[1:])
	}
	return dir, nil
}

// cliAsset is the release asset for this platform.
func (a *App) cliAsset() (string, bool) {
	asset, ok := cliAssets[a.cliRuntime.goos+"/"+a.cliRuntime.goarch]
	return asset, ok
}

// findCLIRelease reads the release on channel and its version: the tag of
// the latest release, or the name of the nightly. It checks this platform
// has a build first, so a platform without one asks GitHub nothing.
func (a *App) findCLIRelease(ctx context.Context, channel Channel) (githubRelease, string, error) {
	asset, ok := a.cliAsset()
	if !ok {
		return githubRelease{}, "", failed(UpdateFailureNoBuild, cliNoBuildReason)
	}
	source := releaseSource{base: a.cliRuntime.releaseSource, client: a.updateHTTPClient()}
	var release githubRelease
	var err error
	if channel == channelNightly {
		release, err = source.releaseByTag(ctx, "nightly")
	} else {
		release, err = source.latestRelease(ctx)
	}
	nightly := channel == channelNightly
	switch {
	case errors.Is(err, errReleaseNotFound) && nightly:
		return githubRelease{}, "", failed(UpdateFailureNetwork, cliNightlyMissingReason)
	case errors.Is(err, errReleaseNotFound):
		return githubRelease{}, "", failed(UpdateFailureNetwork, "No Marasi release published")
	case err != nil:
		return githubRelease{}, "", failed(UpdateFailureNetwork, "%v", err)
	}
	if _, ok := release.asset(asset); !ok {
		if nightly {
			// The nightly is recreated on each run; its assets may still be
			// uploading.
			return githubRelease{}, "", failed(UpdateFailureNetwork, cliNightlyMissingReason)
		}
		return githubRelease{}, "", failed(UpdateFailureNoBuild, cliNoBuildReason)
	}
	version := release.Tag
	if nightly {
		version = release.Name
	}
	return release, version, nil
}

// installCLIRelease downloads this platform's CLI from release, verifies it
// and moves it to target. Nothing touches target's folder until the build
// is verified.
func (a *App) installCLIRelease(ctx context.Context, release githubRelease, channel Channel, version, target string) error {
	r := &a.cliRuntime
	asset, _ := a.cliAsset()
	checksumsURL, ok := release.asset(checksumsAsset)
	if !ok {
		return failed(UpdateFailureSignature, "The release has no %s", checksumsAsset)
	}
	signatureURL, ok := release.asset(signatureAsset)
	if !ok {
		return failed(UpdateFailureSignature, "The release isn't signed")
	}
	build, _ := release.asset(asset)

	a.reportCLIProgress(CLIInstallProgress{Step: "download"})
	checksums, err := a.downloadCLISmall(ctx, checksumsURL.URL)
	if err != nil {
		return err
	}
	signature, err := a.downloadCLISmall(ctx, signatureURL.URL)
	if err != nil {
		return err
	}
	if !minisign.Verify(r.key, checksums, signature) {
		return failed(UpdateFailureSignature, "Signature check failed, nothing installed")
	}
	if trustedComment(signature) != "marasi "+string(channel)+" "+version {
		return failed(UpdateFailureSignature, "Signature is for another release, nothing installed")
	}
	want, ok := parseChecksums(checksums)[asset]
	if !ok {
		return failed(UpdateFailureChecksum, "Signed checksums don't list %s, nothing installed", asset)
	}

	tmp, err := r.tempDir()
	if err != nil {
		return failed(UpdateFailureInstall, "Could not make room for the download: %v", err)
	}
	defer r.remove(tmp)
	download := filepath.Join(tmp, asset)
	got, err := a.downloadCLIBuild(ctx, build.URL, download)
	if err != nil {
		return err
	}
	a.reportCLIProgress(CLIInstallProgress{Step: "verify"})
	if got != want {
		return failed(UpdateFailureChecksum, "Checksum mismatch, nothing installed")
	}
	a.reportCLIProgress(CLIInstallProgress{Step: "install"})
	return a.placeCLI(download, target)
}

// placeCLI copies the verified build next to target, marks the copy
// executable on Unix, then renames it over target, so a failure at any step
// leaves target as it was.
func (a *App) placeCLI(download, target string) error {
	r := &a.cliRuntime
	dir := filepath.Dir(target)
	if err := r.mkdirAll(dir); err != nil {
		return failed(UpdateFailureInstall, "Could not create %s: %v", dir, err)
	}
	file, err := os.Open(download)
	if err != nil {
		return failed(UpdateFailureInstall, "Could not read the download: %v", err)
	}
	defer file.Close()
	staged := filepath.Join(dir, fmt.Sprintf(".%s.%d.new", filepath.Base(target), time.Now().UnixNano()))
	if err := r.writeFile(staged, file); err != nil {
		r.remove(staged)
		return failed(UpdateFailureInstall, "Could not write to %s: %v", dir, err)
	}
	if r.goos != "windows" {
		if err := r.chmod(staged, 0o755); err != nil {
			r.remove(staged)
			return failed(UpdateFailureInstall, "Could not make %s executable: %v", target, err)
		}
	}
	if err := r.rename(staged, target); err != nil {
		r.remove(staged)
		return failed(UpdateFailureInstall, "Could not install to %s: %v", target, err)
	}
	return nil
}

func (a *App) downloadCLISmall(ctx context.Context, url string) ([]byte, error) {
	body, _, err := a.cliRuntime.download(ctx, url)
	if err != nil {
		return nil, failed(UpdateFailureNetwork, "Download failed: %v", err)
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, cliSmallAssetLimit))
	if err != nil {
		return nil, failed(UpdateFailureNetwork, "Download failed: %v", err)
	}
	return data, nil
}

// downloadCLIBuild downloads url to path, reporting progress, and returns
// its SHA-256 in hex.
func (a *App) downloadCLIBuild(ctx context.Context, url, path string) (string, error) {
	body, size, err := a.cliRuntime.download(ctx, url)
	if err != nil {
		return "", failed(UpdateFailureNetwork, "Download failed: %v", err)
	}
	defer body.Close()
	total := max(size, 0)
	progress := newProgressReporter(total, func(p UpdateProgress) {
		a.reportCLIProgress(CLIInstallProgress{Step: "download", Received: p.Received, Total: p.Total})
	})
	hash := sha256.New()
	if err := a.cliRuntime.writeFile(path, io.TeeReader(body, io.MultiWriter(hash, progress))); err != nil {
		return "", failed(UpdateFailureNetwork, "Download failed: %v", err)
	}
	progress.done()
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// trustedComment is the trusted comment of a minisign signature file.
func trustedComment(signature []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(signature))
	for scanner.Scan() {
		if comment, ok := strings.CutPrefix(scanner.Text(), "trusted comment: "); ok {
			return strings.TrimSpace(comment)
		}
	}
	return ""
}
