package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
)

// Installing the Marasi CLI a release or nightly build carries (ADR "The app
// carries a compressed CLI it installs once"). Tests give the cliRuntime a
// carried copy; the real one comes from the carried_cli build tag.

// carriedCopy is a carried CLI holding binary, built as version on channel
// for goos/goarch.
func carriedCopy(t *testing.T, binary []byte, version, channel, goos, goarch string) *carriedCLI {
	t.Helper()
	var gzipped bytes.Buffer
	w := gzip.NewWriter(&gzipped)
	if _, err := w.Write(binary); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(binary)
	return &carriedCLI{
		Version: version, Channel: channel, GOOS: goos, GOARCH: goarch,
		SHA256:  hex.EncodeToString(sum[:]),
		gzipped: gzipped.Bytes(),
	}
}

// countedTransport answers every request with err, or passes it to next
// when err is nil, and counts them.
type countedTransport struct {
	mu    sync.Mutex
	count int
	err   error
	next  http.RoundTripper
}

func (c *countedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	c.mu.Lock()
	c.count++
	c.mu.Unlock()
	if c.err != nil {
		return nil, c.err
	}
	return c.next.RoundTrip(req)
}

func (c *countedTransport) requests() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}

// carriedInstall is newCLIInstall with a carried copy of cliBinaryOld
// (30.10.2026 on release) for linux/amd64, network requests counted, and
// background work held until the test runs it.
type carriedInstall struct {
	*cliInstall
	network    *countedTransport
	background []func()
}

func newCarriedInstall(t *testing.T) *carriedInstall {
	t.Helper()
	c := &carriedInstall{cliInstall: newCLIInstall(t, "linux", "amd64")}
	c.network = &countedTransport{next: c.app.updateClient.Transport}
	c.app.updateClient = &http.Client{Transport: c.network}
	r := &c.app.cliRuntime
	r.carried = carriedCopy(t, cliBinaryOld, "30.10.2026", "release", "linux", "amd64")
	r.background = func(work func()) { c.background = append(c.background, work) }
	return c
}

// runBackground runs the background work InstallCLI started.
func (c *carriedInstall) runBackground() {
	work := c.background
	c.background = nil
	for _, run := range work {
		run()
	}
}

func TestInstallCLIPlacesTheCarriedCopyWithoutTheNetwork(t *testing.T) {
	c := newCarriedInstall(t)
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))
	dir := filepath.Join(t.TempDir(), "bin")

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if c.network.requests() != 0 || c.releases.requestCount() != 0 {
		t.Fatalf("Install made %d requests (%v), want none", c.network.requests(), c.releases.requested())
	}
	if result.Outcome != "installed" || result.Version != "30.10.2026" || result.Channel != "release" {
		t.Fatalf("result = %+v, want the carried 30.10.2026 on release installed", result)
	}
	installed := filepath.Join(dir, "marasi")
	data, err := os.ReadFile(installed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, cliBinaryOld) {
		t.Fatalf("installed %q, want the carried copy", data)
	}
	if got := dirFiles(t, dir); !slices.Equal(got, []string{"marasi"}) {
		t.Fatalf("folder holds %v, want only marasi", got)
	}
	if info, err := os.Stat(installed); err != nil || info.Mode()&0o111 == 0 {
		t.Fatalf("installed CLI isn't executable: %v %v", info, err)
	}
	if saved := c.app.Config.cliPath(); saved.Path != installed || saved.Source != "installed" {
		t.Fatalf("app config holds %+v, want the installed path", saved)
	}
	if !result.CLI.Found || result.CLI.Path != installed || result.CLI.Version != "30.10.2026" {
		t.Fatalf("CLI = %+v, want the installed carried copy", result.CLI)
	}
	if steps := cliProgressSteps(c.events); !slices.Equal(steps, []string{"extract"}) {
		t.Fatalf("progress steps = %v, want [extract]", steps)
	}

	// Then the update check replaces it with the channel's newer release.
	if len(c.background) != 1 {
		t.Fatalf("Install started %d background jobs, want the update check", len(c.background))
	}
	c.runBackground()
	if data, _ := os.ReadFile(installed); !bytes.Equal(data, cliBinaryNew) {
		t.Fatalf("after the update check the CLI is %q, want 06.11.2026", data)
	}
}

func TestInstallCLIFromTheCarriedCopySucceedsWhenTheReleaseServerIsUnreachable(t *testing.T) {
	c := newCarriedInstall(t)
	c.network.err = errors.New("connection refused")
	dir := filepath.Join(t.TempDir(), "bin")

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "installed" {
		t.Fatalf("result = %+v, want installed", result)
	}

	c.runBackground()
	if c.network.requests() == 0 {
		t.Fatal("no update check ran after the install")
	}
	installed := filepath.Join(dir, "marasi")
	if data, _ := os.ReadFile(installed); !bytes.Equal(data, cliBinaryOld) {
		t.Fatalf("after a failed update check the CLI is %q, want the carried copy", data)
	}
	if saved := c.app.Config.cliPath(); saved.Path != installed {
		t.Fatalf("app config holds %+v, want the installed path", saved)
	}
}

func TestInstallCLIWithoutACarriedCopyDownloads(t *testing.T) {
	c := newCarriedInstall(t)
	c.app.cliRuntime.carried = nil
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))
	dir := filepath.Join(t.TempDir(), "bin")

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "installed" || result.Version != "06.11.2026" {
		t.Fatalf("result = %+v, want 06.11.2026 downloaded", result)
	}
	if c.releases.requestCount() == 0 {
		t.Fatal("Install requested nothing, want a download")
	}
	if len(c.background) != 0 {
		t.Fatalf("a download started %d background jobs, want none", len(c.background))
	}
}

func TestInstallCLINeverReplacesAnExistingCLIWithTheCarriedCopy(t *testing.T) {
	c := newCarriedInstall(t)
	onPath := filepath.Join(t.TempDir(), "marasi")
	if err := os.WriteFile(onPath, cliBinaryNew, 0o755); err != nil {
		t.Fatal(err)
	}
	c.app.cliRuntime.lookPath = func(string) (string, error) { return onPath, nil }
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))
	dir := filepath.Join(t.TempDir(), "bin")

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if result.Version != "06.11.2026" || c.releases.requestCount() == 0 {
		t.Fatalf("result = %+v after %v, want a download, not the carried copy", result, c.releases.requested())
	}
	if data, _ := os.ReadFile(onPath); !bytes.Equal(data, cliBinaryNew) {
		t.Fatalf("the CLI on PATH became %q", data)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "marasi")); bytes.Equal(data, cliBinaryOld) {
		t.Fatal("installed the carried copy beside an existing CLI")
	}
}

func TestInstallCLIIgnoresACarriedCopyForAnotherPlatform(t *testing.T) {
	c := newCarriedInstall(t)
	c.app.cliRuntime.carried = carriedCopy(t, cliBinaryOld, "30.10.2026", "release", "darwin", "arm64")
	publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", map[string][]byte{"marasi-linux-amd64": cliBinaryNew}))

	result, err := c.app.InstallCLI(filepath.Join(t.TempDir(), "bin"))
	if err != nil {
		t.Fatal(err)
	}

	if result.Version != "06.11.2026" {
		t.Fatalf("result = %+v, want a download", result)
	}
}

func TestInstallCLIRefusesACarriedCopyThatDoesNotMatchItsChecksum(t *testing.T) {
	c := newCarriedInstall(t)
	carried := carriedCopy(t, []byte("corrupted"), "30.10.2026", "release", "linux", "amd64")
	carried.SHA256 = c.app.cliRuntime.carried.SHA256
	c.app.cliRuntime.carried = carried
	dir := filepath.Join(t.TempDir(), "bin")

	result, err := c.app.InstallCLI(dir)
	if err != nil {
		t.Fatal(err)
	}

	if result.Outcome != "failed" || result.Failure.Kind != "checksum" {
		t.Fatalf("result = %+v, want a checksum failure", result)
	}
	if got := dirFiles(t, dir); len(got) != 0 {
		t.Fatalf("folder holds %v, want nothing", got)
	}
	if saved := c.app.Config.cliPath(); saved.Path != "" {
		t.Fatalf("app config holds %+v, want nothing saved", saved)
	}
	if len(c.background) != 0 {
		t.Fatal("a failed install started the update check")
	}
}

func TestLoadCarriedCLIReadsItsRecord(t *testing.T) {
	carried, ok := loadCarriedCLI(
		[]byte(`{"version":"06.11.2026 (nightly 7d411bd)","channel":"nightly","goos":"darwin","goarch":"arm64","sha256":"ab"}`),
		[]byte("gz"),
	)
	if !ok || carried.Version != "06.11.2026 (nightly 7d411bd)" || carried.Channel != "nightly" ||
		carried.GOOS != "darwin" || carried.GOARCH != "arm64" || carried.SHA256 != "ab" || string(carried.gzipped) != "gz" {
		t.Fatalf("loadCarriedCLI = %+v, %v", carried, ok)
	}
	for name, tc := range map[string]struct{ record, gzipped string }{
		"no copy":          {"", ""},
		"no record":        {"", "gz"},
		"malformed record": {"{", "gz"},
		"no version":       {`{"channel":"release","goos":"linux","goarch":"amd64","sha256":"ab"}`, "gz"},
		"no checksum":      {`{"version":"1","channel":"release","goos":"linux","goarch":"amd64"}`, "gz"},
	} {
		if _, ok := loadCarriedCLI([]byte(tc.record), []byte(tc.gzipped)); ok {
			t.Errorf("%s: loadCarriedCLI reports a carried copy", name)
		}
	}
}

// cliProgressSteps lists the steps of the cli-install-progress events,
// each once in order.
func cliProgressSteps(events *recordedEvents) []string {
	events.mu.Lock()
	defer events.mu.Unlock()
	var steps []string
	for i, name := range events.names {
		if name != cliInstallProgressEvent {
			continue
		}
		step := events.data[i][0].(CLIInstallProgress).Step
		if len(steps) == 0 || steps[len(steps)-1] != step {
			steps = append(steps, step)
		}
	}
	return steps
}
