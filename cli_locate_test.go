package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// Locating the Marasi CLI: the custom path in app config first, then marasi
// on PATH, each accepted only when it answers `service status --json` the
// way Marasi does. The CLI is replaced by cliProbes, answers per path.

// cliProbes answers `service status --json` per CLI path, and records the
// paths it ran.
type cliProbes struct {
	answers map[string]cliAnswer
	ran     []string
}

func (p *cliProbes) run(_ context.Context, path string, args, _ []string) ([]byte, int, error) {
	p.ran = append(p.ran, path)
	answer, ok := p.answers[path]
	if !ok {
		return nil, 0, &os.PathError{Op: "fork/exec", Path: path, Err: os.ErrNotExist}
	}
	return []byte(answer.stdout), answer.exit, nil
}

const notMarasiUsage = "usage: ls [-@ABCFGHILOPRSTUWXabcdefghiklmnopqrstuvwxy1%,] [file ...]"

// cliTestApp is an App with an app config in a temp dir, CLIs answering
// through probes, marasi on PATH at onPath ("" for none), and every CLI
// reading as the nightly 06.11.2026 build.
func cliTestApp(t *testing.T, probes *cliProbes, onPath string) *App {
	t.Helper()
	t.Setenv(cliConfigDirEnv, "")
	config, err := LoadConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &App{Config: config}
	app.useLocalInstanceRuntime()
	app.runCLI = probes.run
	app.cliRuntime.lookPath = func(name string) (string, error) {
		if name != "marasi" {
			t.Fatalf("looked up %q on PATH, want marasi", name)
		}
		if onPath == "" {
			return "", exec.ErrNotFound
		}
		return onPath, nil
	}
	app.cliRuntime.readBuild = func(path string) (cliBuild, error) {
		return cliBuild{Version: "06.11.2026 (nightly 7d411bd)", Channel: "nightly"}, nil
	}
	return app
}

func TestLocateCLIPrefersTheCustomPathOverPATH(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/opt/custom/marasi":    {exit: 1, stdout: notRunning},
		"/usr/local/bin/marasi": {exit: 0, stdout: runningWithCtl},
	}}
	app := cliTestApp(t, probes, "/usr/local/bin/marasi")
	if _, err := app.UseCLIPath("/opt/custom/marasi"); err != nil {
		t.Fatal(err)
	}

	info, err := app.LocateCLI()
	if err != nil {
		t.Fatal(err)
	}

	if !info.Found || info.Path != "/opt/custom/marasi" || info.Source != "custom" {
		t.Fatalf("located %+v, want the custom path", info)
	}
	if info.Version != "06.11.2026 (nightly 7d411bd)" {
		t.Fatalf("version = %q, want the CLI's build version", info.Version)
	}
}

func TestLocateCLIFindsMarasiOnPATH(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/usr/local/bin/marasi": {exit: 0, stdout: runningWithCtl},
	}}
	app := cliTestApp(t, probes, "/usr/local/bin/marasi")

	info, err := app.LocateCLI()
	if err != nil {
		t.Fatal(err)
	}

	if !info.Found || info.Path != "/usr/local/bin/marasi" || info.Source != "path" {
		t.Fatalf("located %+v, want marasi on PATH", info)
	}
}

func TestLocateCLIFallsBackToPATHWhenTheCustomPathStoppedBeingMarasi(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/opt/custom/marasi":    {exit: 1, stdout: notRunning},
		"/usr/local/bin/marasi": {exit: 1, stdout: notRunning},
	}}
	app := cliTestApp(t, probes, "/usr/local/bin/marasi")
	if _, err := app.UseCLIPath("/opt/custom/marasi"); err != nil {
		t.Fatal(err)
	}
	probes.answers["/opt/custom/marasi"] = cliAnswer{exit: 2, stdout: notMarasiUsage}

	info, err := app.LocateCLI()
	if err != nil {
		t.Fatal(err)
	}

	if info.Path != "/usr/local/bin/marasi" || info.Source != "path" {
		t.Fatalf("located %+v, want PATH after the custom path failed", info)
	}
	if !strings.Contains(info.Problem, "/opt/custom/marasi") {
		t.Fatalf("problem = %q, want it to name the refused custom path", info.Problem)
	}
}

func TestLocateCLIReportsNoCLIWhenThereIsNone(t *testing.T) {
	app := cliTestApp(t, &cliProbes{}, "")

	info, err := app.LocateCLI()
	if err != nil {
		t.Fatal(err)
	}

	if info.Found || info.Path != "" {
		t.Fatalf("located %+v, want nothing", info)
	}
	if _, err := app.findCLI(); err == nil {
		t.Fatal("findCLI found a CLI, want an error")
	}
}

func TestLocateCLIRejectsAProgramOnPATHThatIsNotMarasi(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/usr/bin/marasi": {exit: 0, stdout: "hello"},
	}}
	app := cliTestApp(t, probes, "/usr/bin/marasi")

	info, err := app.LocateCLI()
	if err != nil {
		t.Fatal(err)
	}

	if info.Found {
		t.Fatalf("located %+v, want a non-Marasi program refused", info)
	}
}

func TestUseCLIPathRefusesAProgramThatIsNotMarasiAndSavesNothing(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/bin/ls": {exit: 1, stdout: notMarasiUsage},
	}}
	app := cliTestApp(t, probes, "")

	_, err := app.UseCLIPath("/bin/ls")

	if err == nil || !strings.Contains(err.Error(), "isn't the Marasi CLI") {
		t.Fatalf("UseCLIPath(/bin/ls) = %v, want a refusal", err)
	}
	if saved := app.Config.cliPath(); saved.Path != "" {
		t.Fatalf("saved %+v, want nothing saved", saved)
	}
}

func TestUseCLIPathRefusesAPathThatDoesNotRun(t *testing.T) {
	app := cliTestApp(t, &cliProbes{}, "")

	_, err := app.UseCLIPath("/nowhere/marasi")

	if err == nil || !errors.Is(err, os.ErrNotExist) && !strings.Contains(err.Error(), "isn't the Marasi CLI") {
		t.Fatalf("UseCLIPath(/nowhere/marasi) = %v, want a refusal", err)
	}
}

func TestUseCLIPathSavesAMarasiCLIAndConnectLocalUsesIt(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/opt/custom/marasi": {exit: 1, stdout: notRunning},
	}}
	app := cliTestApp(t, probes, "")

	info, err := app.UseCLIPath("/opt/custom/marasi")
	if err != nil {
		t.Fatal(err)
	}

	if info.Path != "/opt/custom/marasi" || info.Source != "custom" {
		t.Fatalf("UseCLIPath = %+v, want the custom path", info)
	}
	reloaded, err := LoadConfig(app.Config.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	if saved := reloaded.cliPath(); saved.Path != "/opt/custom/marasi" || saved.Source != "custom" {
		t.Fatalf("app config holds %+v, want the custom path", saved)
	}
	if path, err := app.findCLI(); err != nil || path != "/opt/custom/marasi" {
		t.Fatalf("findCLI = %q, %v, want the custom path", path, err)
	}
}

func TestClearCLIPathGoesBackToPATH(t *testing.T) {
	probes := &cliProbes{answers: map[string]cliAnswer{
		"/opt/custom/marasi":    {exit: 1, stdout: notRunning},
		"/usr/local/bin/marasi": {exit: 1, stdout: notRunning},
	}}
	app := cliTestApp(t, probes, "/usr/local/bin/marasi")
	if _, err := app.UseCLIPath("/opt/custom/marasi"); err != nil {
		t.Fatal(err)
	}

	info, err := app.ClearCLIPath()
	if err != nil {
		t.Fatal(err)
	}

	if info.Path != "/usr/local/bin/marasi" || info.Source != "path" {
		t.Fatalf("ClearCLIPath = %+v, want marasi on PATH", info)
	}
	if saved := app.Config.cliPath(); saved.Path != "" {
		t.Fatalf("app config holds %+v, want no custom path", saved)
	}
}

func TestLocateCLIProbesWithTheIsolatedConfigDir(t *testing.T) {
	var args []string
	app := cliTestApp(t, &cliProbes{}, "/usr/local/bin/marasi")
	app.cliConfigDir = "/tmp/isolated"
	app.runCLI = func(_ context.Context, _ string, a, _ []string) ([]byte, int, error) {
		args = a
		return []byte(notRunning), 1, nil
	}

	if _, err := app.LocateCLI(); err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--config-dir /tmp/isolated") || !strings.Contains(joined, "service status") || !strings.Contains(joined, "--json") {
		t.Fatalf("probe args = %q, want service status --json with the isolated config dir", joined)
	}
}
