package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"testing"
	"time"
)

// TestInstallCLIFromARealBuildAnswersServiceStatus installs a real Marasi
// CLI through the app's install path, from a release with the archive and
// from one without, and runs `service status --json` on what it installed.
// The release is served locally and its checksums.txt is signed with a
// test key, so it proves the path before a published release carries
// archives.
//
// It runs only when MARASI_CLI_LIVE_DIST names a folder holding this
// platform's bare build and the archive scripts/archive-cli.sh made from
// it, for example:
//
//	go build -o dist/marasi-darwin-arm64 ./cmd/marasi    # in Marasi
//	scripts/archive-cli.sh dist/marasi-darwin-arm64
//	MARASI_CLI_LIVE_DIST=$PWD/dist GOWORK=off go test -run RealBuild .
func TestInstallCLIFromARealBuildAnswersServiceStatus(t *testing.T) {
	dist := os.Getenv("MARASI_CLI_LIVE_DIST")
	if dist == "" {
		t.Skip("MARASI_CLI_LIVE_DIST not set")
	}
	platform := goruntime.GOOS + "/" + goruntime.GOARCH
	bareName, archiveName := cliAssets[platform], cliArchives[platform]
	bare, err := os.ReadFile(filepath.Join(dist, bareName))
	if err != nil {
		t.Fatal(err)
	}
	archive, err := os.ReadFile(filepath.Join(dist, archiveName))
	if err != nil {
		t.Fatal(err)
	}

	for name, assets := range map[string]map[string][]byte{
		"from the archive":               {bareName: []byte("not this one"), archiveName: archive},
		"from a release without archive": {bareName: bare},
	} {
		t.Run(name, func(t *testing.T) {
			c := newCLIInstall(t, goruntime.GOOS, goruntime.GOARCH)
			publishCLI(c.releases, c.keys, releaseCLI("06.11.2026", assets))
			dir := filepath.Join(t.TempDir(), "bin")

			if _, err := c.app.InstallCLI(dir); err != nil {
				t.Fatal(err)
			}

			// A short HOME keeps the instance socket path under the Unix
			// socket limit.
			home, err := os.MkdirTemp("/tmp", "cli-live-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.RemoveAll(home) })
			cli := func(args ...string) []byte {
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				cmd := exec.CommandContext(ctx, filepath.Join(dir, cliFileName(goruntime.GOOS)), args...)
				cmd.Env = append(os.Environ(), "HOME="+home, "XDG_CONFIG_HOME="+filepath.Join(home, ".config"))
				out, _ := cmd.Output()
				return out
			}
			cli("service", "start", "--instance", "live", "--port", "0")
			t.Cleanup(func() { cli("service", "stop", "--instance", "live") })

			out := cli("service", "status", "--instance", "live", "--json")
			var status struct {
				Status string `json:"status"`
				RunID  string `json:"run_id"`
			}
			if err := json.Unmarshal(out, &status); err != nil {
				t.Fatalf("service status --json printed %q: %v", out, err)
			}
			if status.Status != "running" || status.RunID == "" {
				t.Fatalf("service status --json = %s, want a running instance", out)
			}
			t.Logf("service status --json: %s", out)
		})
	}
}
