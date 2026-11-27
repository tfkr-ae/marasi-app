package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"log"
)

// The Marasi CLI a release or nightly build carries, gzipped (ADR
// docs/adr/2026-11-08-the-app-carries-a-compressed-cli-it-installs-once.md).
// CI fetches it from the CLI release on the app's channel, verifies it
// (cmd/carry-cli) and builds with the carried_cli tag, which embeds
// carried_cli/marasi.gz and its record carried_cli/carried.json
// (cli_carried_embed.go). A development build carries none
// (cli_carried_none.go). The app never runs the carried copy: Install only
// places it, as a download is placed, when no CLI is found, and
// InstallCarriedCLI places it over the current CLI when a researcher asks.

// carriedCLI is the carried copy and its record, written by cmd/carry-cli.
type carriedCLI struct {
	// Version and Channel are the CLI release it came from, as its build
	// reports them.
	Version string `json:"version"`
	Channel string `json:"channel"`
	// GOOS and GOARCH are the platform it runs on.
	GOOS   string `json:"goos"`
	GOARCH string `json:"goarch"`
	// SHA256 is the executable's checksum, as the release's signed
	// checksums.txt lists it.
	SHA256 string `json:"sha256"`

	gzipped []byte
}

// loadCarriedCLI reads the embedded copy and its record; ok is false when
// there is no copy or its record is incomplete.
func loadCarriedCLI(record, gzipped []byte) (*carriedCLI, bool) {
	if len(gzipped) == 0 {
		return nil, false
	}
	var carried carriedCLI
	if err := json.Unmarshal(record, &carried); err != nil {
		log.Printf("the carried Marasi CLI's record is malformed, so Install downloads: %v", err)
		return nil, false
	}
	if carried.Version == "" || carried.Channel == "" || carried.GOOS == "" || carried.GOARCH == "" || carried.SHA256 == "" {
		log.Printf("the carried Marasi CLI's record is incomplete, so Install downloads: %s", record)
		return nil, false
	}
	carried.gzipped = gzipped
	return &carried, true
}

// buildCarriedCLI is the copy this build carries, or nil.
func buildCarriedCLI() *carriedCLI {
	carried, ok := loadCarriedCLI(carriedCLIRecord, carriedCLIGzipped)
	if !ok {
		return nil
	}
	return carried
}

// usableCarriedCLI is the carried copy Install may place: one for this
// platform, and only while the app finds no CLI, so Install never replaces
// an existing CLI with it (InstallCarriedCLI does, when asked).
func (a *App) usableCarriedCLI() (*carriedCLI, bool) {
	carried, ok := a.carriedForPlatform()
	if !ok {
		return nil, false
	}
	if current, err := a.LocateCLI(); err != nil || current.Found {
		return nil, false
	}
	return carried, true
}

// CarriedCLIInfo is the CLI this build carries, for Local's Connection details
// and carried CLI upgrade prompts.
type CarriedCLIInfo struct {
	// Available is false when the build carries no CLI for this platform
	// (a development build, say); the rest is then empty.
	Available bool   `json:"available"`
	Version   string `json:"version"`
	Channel   string `json:"channel"`
}

// carriedForPlatform is the carried copy when it is for this platform.
func (a *App) carriedForPlatform() (*carriedCLI, bool) {
	r := &a.cliRuntime
	carried := r.carried
	if carried == nil || carried.GOOS != r.goos || carried.GOARCH != r.goarch {
		return nil, false
	}
	return carried, true
}

// CarriedCLI reports the CLI this build carries, so Connections can offer
// installing or reinstalling it offline.
func (a *App) CarriedCLI() CarriedCLIInfo {
	carried, ok := a.carriedForPlatform()
	if !ok {
		return CarriedCLIInfo{}
	}
	return CarriedCLIInfo{Available: true, Version: carried.Version, Channel: carried.Channel}
}

// InstallCarriedCLI replaces the CLI the app uses with the copy this build
// carries, without the network, when the researcher applies or reinstalls the
// carried CLI in Connections. It overwrites even when the installed CLI has
// the same version and channel. It returns an error when there is no CLI
// (Install covers that) and a failed result when the build carries none.
func (a *App) InstallCarriedCLI() (CLIInstall, error) {
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

	carried, ok := a.carriedForPlatform()
	if !ok {
		return a.cliFailed(CLIInstall{CLI: current}, failed(UpdateFailureNoBuild, "This build carries no Marasi CLI")), nil
	}
	result := CLIInstall{Version: carried.Version, Channel: carried.Channel, CLI: current}
	if err := a.installCarriedCLI(carried, current.Path); err != nil {
		return a.cliFailed(result, err), nil
	}
	result.Outcome = cliOutcomeInstalled
	result.CLI, _ = a.LocateCLI()
	return result, nil
}

// errCarriedChecksum: the extracted copy isn't the executable CI verified.
var errCarriedChecksum = errors.New("the carried Marasi CLI doesn't match its checksum")

// installCarriedCLI extracts the carried copy straight into placeCLI, which
// writes it beside target and renames it in. The copy's checksum is checked
// as the last byte is read, so a mismatch fails the write and target is
// left as it was.
func (a *App) installCarriedCLI(carried *carriedCLI, target string) error {
	a.reportCLIProgress(CLIInstallProgress{Step: "extract"})
	gz, err := gzip.NewReader(bytes.NewReader(carried.gzipped))
	if err != nil {
		return failed(UpdateFailureInstall, "Could not extract the carried Marasi CLI: %v", err)
	}
	defer gz.Close()
	src := &checkedReader{r: gz, hash: sha256.New(), want: carried.SHA256}
	err = a.placeCLI(src, target)
	if src.mismatch {
		return failed(UpdateFailureChecksum, "Checksum mismatch, nothing installed")
	}
	return err
}

// checkedReader reads r and, at its end, fails with errCarriedChecksum
// unless what it read has the SHA-256 want.
type checkedReader struct {
	r        io.Reader
	hash     hash.Hash
	want     string
	mismatch bool
}

func (c *checkedReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.hash.Write(p[:n])
	if err == io.EOF && hex.EncodeToString(c.hash.Sum(nil)) != c.want {
		c.mismatch = true
		return n, errCarriedChecksum
	}
	return n, err
}
