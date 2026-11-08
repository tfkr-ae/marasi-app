package main

import (
	"context"
	"debug/buildinfo"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"sync"
	"time"

	"aead.dev/minisign"

	"github.com/tfkr-ae/marasi-app/internal/marasicli"
)

// The Marasi CLI (GLOSSARY "Marasi CLI"): the app never runs a CLI from
// inside itself. It finds one, or installs one, from the copy a release or
// nightly build carries or from Marasi's GitHub releases, and updates it
// from those releases
// (docs/adr/2026-11-08-the-app-carries-a-compressed-cli-it-installs-once.md).
//
//   - cli.go: the replaceable functions every CLI effect goes through, and
//     reading a CLI's build;
//   - cli_config.go: the custom CLI path and the CLI channel in app config;
//   - cli_locate.go: finding the CLI (custom path, then PATH) and checking
//     a candidate is Marasi;
//   - cli_install.go: installing and updating it, verified against
//     marasiCLIPublicKey;
//   - cli_archive.go: extracting a release's archive build;
//   - cli_carried.go: the CLI a release or nightly build carries.
//
// Running the CLI goes through App.runCLI (local_instance.go).

// defaultCLIReleaseSource is the GitHub releases API of the Marasi
// repository, which publishes the CLI builds.
const defaultCLIReleaseSource = marasicli.ReleaseSource

// marasiCLIPublicKey is the minisign public key Marasi signs its releases'
// checksums.txt with. It is built into the app whatever the build, so a
// development build can install a CLI too, and cmd/carry-cli verifies the
// carried CLI with it.
const marasiCLIPublicKey = marasicli.PublicKey

// cliRuntime holds the replaceable functions the CLI's locate, install and
// update go through. useCLIRuntime sets the real ones; tests replace them.
type cliRuntime struct {
	// lookPath finds a program on PATH.
	lookPath func(name string) (string, error)
	// readBuild reads the version and channel a CLI was built with.
	readBuild func(path string) (cliBuild, error)
	// goos and goarch pick the release asset.
	goos, goarch string
	// releaseSource is the GitHub releases API base URL.
	releaseSource string
	// key verifies checksums.txt.minisig.
	key minisign.PublicKey
	// download fetches url and returns its body and size (-1 when the
	// server doesn't say). The caller closes the body.
	download func(ctx context.Context, url string) (io.ReadCloser, int64, error)
	// tempDir makes a directory for downloads, outside the install folder.
	tempDir func() (string, error)
	// writeFile creates path, which must not exist, with the contents of r.
	writeFile func(path string, r io.Reader) error
	// chmod sets path's mode (the executable bit on Unix).
	chmod func(path string, mode os.FileMode) error
	// rename moves from over to.
	rename func(from, to string) error
	// remove deletes path.
	remove func(path string) error
	// mkdirAll creates a folder and its parents.
	mkdirAll func(path string) error
	// homeDir and getenv find the default install folder.
	homeDir func() (string, error)
	getenv  func(name string) string
	// sleep waits between attempts to remove a CLI an update moved aside.
	sleep func(d time.Duration)
	// carried is the CLI this build carries (cli_carried.go), nil for none.
	carried *carriedCLI
	// background runs work, such as the update check after Install places
	// the carried CLI, without waiting for it.
	background func(work func())

	// mu makes installs and updates run one at a time.
	mu sync.Mutex
}

// useCLIRuntime points the CLI's replaceable functions at the real ones.
func (a *App) useCLIRuntime() {
	key, err := parseMinisignKey(marasiCLIPublicKey)
	if err != nil {
		panic(fmt.Sprintf("the built-in Marasi CLI key is malformed: %v", err))
	}
	r := &a.cliRuntime
	r.lookPath = exec.LookPath
	r.readBuild = readCLIBuild
	r.goos, r.goarch = goruntime.GOOS, goruntime.GOARCH
	r.releaseSource = defaultCLIReleaseSource
	r.key = key
	r.download = a.downloadURL
	r.tempDir = func() (string, error) { return os.MkdirTemp("", "marasi-cli-") }
	r.writeFile = writeNewFile
	r.chmod = os.Chmod
	r.rename = os.Rename
	r.remove = os.RemoveAll
	r.mkdirAll = func(path string) error { return os.MkdirAll(path, 0o755) }
	r.homeDir = os.UserHomeDir
	r.getenv = os.Getenv
	r.sleep = time.Sleep
	r.carried = buildCarriedCLI()
	r.background = func(work func()) { go work() }
}

func parseMinisignKey(text string) (minisign.PublicKey, error) {
	var key minisign.PublicKey
	err := key.UnmarshalText([]byte(text))
	return key, err
}

// downloadURL fetches url with the updater's HTTP client, which honours the
// system proxy but never goes through Marasi's own listener.
func (a *App) downloadURL(ctx context.Context, url string) (io.ReadCloser, int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", "marasi-app")
	res, err := a.updateHTTPClient().Do(req)
	if err != nil {
		return nil, 0, unwrapURLError(err)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, 0, fmt.Errorf("GitHub answered %s", res.Status)
	}
	return res.Body, res.ContentLength, nil
}

// writeNewFile creates path, refusing one that exists, and fills it from r.
func writeNewFile(path string, r io.Reader) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, r); err != nil {
		file.Close()
		os.Remove(path)
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(path)
		return err
	}
	return file.Close()
}

// cliBuild is what a CLI was built as: its version ("dev" for a build
// without one) and channel ("" for none).
type cliBuild struct {
	Version string
	Channel string
}

// readCLIBuild reads the version and channel from the CLI's Go build info,
// where Marasi's Makefile leaves them as -X flags in -ldflags. Marasi has no
// version command, and this runs nothing.
func readCLIBuild(path string) (cliBuild, error) {
	info, err := buildinfo.ReadFile(path)
	if err != nil {
		return cliBuild{}, err
	}
	for _, setting := range info.Settings {
		if setting.Key == "-ldflags" {
			return parseCLILdflags(setting.Value), nil
		}
	}
	return cliBuild{Version: "dev"}, nil
}

var ldflagsX = regexp.MustCompile(`-X\s+(?:'([^']*)'|"([^"]*)"|(\S+))`)

// parseCLILdflags reads main.version and main.buildChannel from -ldflags.
func parseCLILdflags(ldflags string) cliBuild {
	build := cliBuild{Version: "dev"}
	for _, match := range ldflagsX.FindAllStringSubmatch(ldflags, -1) {
		flag := match[1] + match[2] + match[3]
		name, value, ok := cutAssignment(flag)
		if !ok {
			continue
		}
		switch name {
		case "main.version":
			if value != "" {
				build.Version = value
			}
		case "main.buildChannel":
			if value == "release" || value == "nightly" {
				build.Channel = value
			}
		}
	}
	return build
}

func cutAssignment(flag string) (name, value string, ok bool) {
	for i := 0; i < len(flag); i++ {
		if flag[i] == '=' {
			return flag[:i], flag[i+1:], true
		}
	}
	return "", "", false
}

// cliFileName is the CLI's file name on goos.
func cliFileName(goos string) string {
	if goos == "windows" {
		return "marasi.exe"
	}
	return "marasi"
}

// DefaultCLIInstallDir is the folder Install suggests: ~/.local/bin, or
// %LOCALAPPDATA%\Programs\marasi on Windows.
func (a *App) DefaultCLIInstallDir() string {
	r := &a.cliRuntime
	if r.goos == "windows" {
		if local := r.getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, "Programs", "marasi")
		}
	}
	home, err := r.homeDir()
	if err != nil {
		return ""
	}
	if r.goos == "windows" {
		return filepath.Join(home, "AppData", "Local", "Programs", "marasi")
	}
	return filepath.Join(home, ".local", "bin")
}
