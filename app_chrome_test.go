package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	goruntime "runtime"
	"slices"
	"strings"
	"testing"
	"time"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/chrome"
	"github.com/tfkr-ae/marasi/service"
)

func TestAppChrome(t *testing.T) {
	t.Run("should list a path another instance added", func(t *testing.T) {
		app := newProjectApp(t)
		other := newSharedConfigChrome(t, app)
		added := chrome.PathConfig{OS: "darwin", Path: "/service/chrome"}
		if _, err := other.AddPath(context.Background(), added); err != nil {
			t.Fatalf("adding path from another instance: %v", err)
		}
		if paths, _ := app.GetChromePaths(); !slices.Contains(paths, added) {
			t.Fatalf("wanted: %v in paths\ngot: %v", added, paths)
		}
	})

	t.Run("should keep a path another instance added when adding one", func(t *testing.T) {
		app := newProjectApp(t)
		app.GetChromePaths()
		other := newSharedConfigChrome(t, app)
		fromService := chrome.PathConfig{OS: "darwin", Path: "/service/chrome"}
		if _, err := other.AddPath(context.Background(), fromService); err != nil {
			t.Fatalf("adding path from another instance: %v", err)
		}
		fromApp := chrome.PathConfig{OS: "darwin", Path: "/app/chrome"}
		paths, err := app.AddChromePath(fromApp.Path, fromApp.OS)
		if err != nil {
			t.Fatalf("adding path: %v", err)
		}
		if !slices.Contains(paths, fromService) || !slices.Contains(paths, fromApp) {
			t.Fatalf("wanted: %v and %v in paths\ngot: %v", fromService, fromApp, paths)
		}
		saved, err := other.Paths(context.Background())
		if err != nil {
			t.Fatalf("reading saved paths: %v", err)
		}
		if !slices.Contains(saved, fromService) || !slices.Contains(saved, fromApp) {
			t.Fatalf("wanted: %v and %v saved\ngot: %v", fromService, fromApp, saved)
		}
	})

	t.Run("should list a profile another instance added", func(t *testing.T) {
		app := newProjectApp(t)
		other := newSharedConfigChrome(t, app)
		if _, err := other.AddProfile(context.Background(), "service-profile"); err != nil {
			t.Fatalf("adding profile from another instance: %v", err)
		}
		if profiles, _ := app.GetChromeProfiles(); !slices.Contains(profiles, "service-profile") {
			t.Fatalf("wanted: service-profile in profiles\ngot: %v", profiles)
		}
	})

	t.Run("should report an invalid websocket_max_message_size from every Chrome setting", func(t *testing.T) {
		app := newProjectApp(t)
		writeInvalidMaxMessageSize(t, app)
		calls := map[string]func() error{
			"GetChromePaths":      func() error { _, err := app.GetChromePaths(); return err },
			"AddChromePath":       func() error { _, err := app.AddChromePath("/app/chrome", "darwin"); return err },
			"DeleteChromePath":    func() error { _, err := app.DeleteChromePath("/app/chrome", "darwin"); return err },
			"GetChromeProfiles":   func() error { _, err := app.GetChromeProfiles(); return err },
			"AddChromeProfile":    func() error { _, err := app.AddChromeProfile("p"); return err },
			"DeleteChromeProfile": func() error { _, err := app.DeleteChromeProfile("p"); return err },
		}
		for name, call := range calls {
			err := call()
			if err == nil || !strings.Contains(err.Error(), "invalid configuration") || !strings.Contains(err.Error(), "websocket_max_message_size") {
				t.Errorf("%s: wanted: invalid configuration error naming websocket_max_message_size\ngot: %v", name, err)
			}
		}
	})

	t.Run("should aim Chrome at the local connection's proxy listener and pin its SPKI hash", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ConnectionURL: "http://127.0.0.1:51391", ProxyListener: "127.0.0.1:51390", SPKIHash: "spki-from-service"})
		if err != nil {
			t.Fatalf("starting Chrome: %v", err)
		}
		want := ChromeLaunch{Address: "127.0.0.1", Port: "51390", SPKIHash: "spki-from-service", ConfigDir: app.Proxy.ConfigDir, Profile: "default-profile", Paths: []chrome.PathConfig{}}
		if len(*launches) != 1 || !reflect.DeepEqual((*launches)[0], want) {
			t.Fatalf("wanted: one launch %+v\ngot: %+v", want, *launches)
		}
	})
	t.Run("should aim Chrome at loopback when the local listener binds every address", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		for _, listener := range []string{"0.0.0.0:8080", "[::]:8080"} {
			if err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: listener, SPKIHash: "h"}); err != nil {
				t.Fatalf("starting Chrome on %s: %v", listener, err)
			}
		}
		for _, launch := range *launches {
			if launch.Address != "127.0.0.1" || launch.Port != "8080" {
				t.Fatalf("wanted: 127.0.0.1:8080\ngot: %s:%s", launch.Address, launch.Port)
			}
		}
	})
	t.Run("should aim Chrome at the remote service's host when its listener binds every address", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "remote", ConnectionURL: "http://lab.example:51391", ProxyListener: "0.0.0.0:8080", SPKIHash: "h"})
		if err != nil {
			t.Fatalf("starting Chrome: %v", err)
		}
		if got := (*launches)[0]; got.Address != "lab.example" || got.Port != "8080" {
			t.Fatalf("wanted: lab.example:8080\ngot: %s:%s", got.Address, got.Port)
		}
	})
	t.Run("should aim Chrome at a remote listener's own address", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "remote", ConnectionURL: "http://lab.example:51391", ProxyListener: "[fd00::5]:8080", SPKIHash: "h"})
		if err != nil {
			t.Fatalf("starting Chrome: %v", err)
		}
		if got := (*launches)[0]; got.Address != "fd00::5" || got.Port != "8080" {
			t.Fatalf("wanted: fd00::5 port 8080\ngot: %s port %s", got.Address, got.Port)
		}
	})
	t.Run("should refuse a remote listener that binds loopback only", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		for _, listener := range []string{"127.0.0.1:8080", "127.0.0.2:8080", "[::1]:8080", "localhost:8080"} {
			err := app.StartBrowser(ChromeStart{ConnectionKind: "remote", ConnectionURL: "http://lab.example:51391", ProxyListener: listener, SPKIHash: "h"})
			if err == nil || !strings.Contains(err.Error(), "listener_loopback:") {
				t.Errorf("%s: wanted: listener_loopback error\ngot: %v", listener, err)
			}
		}
		if len(*launches) != 0 {
			t.Fatalf("wanted: no launch\ngot: %+v", *launches)
		}
	})
	t.Run("should refuse to start Chrome while the proxy listener is stopped", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "local", SPKIHash: "h"})
		if err == nil || !strings.Contains(err.Error(), "listener_inactive:") {
			t.Fatalf("wanted: listener_inactive error\ngot: %v", err)
		}
		if len(*launches) != 0 {
			t.Fatalf("wanted: no launch\ngot: %+v", *launches)
		}
	})
	t.Run("should start a configured profile with the configured paths", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		if _, err := app.AddChromeProfile("work"); err != nil {
			t.Fatalf("adding profile: %v", err)
		}
		path := chrome.PathConfig{OS: "darwin", Path: "/custom/chrome"}
		if _, err := app.AddChromePath(path.Path, path.OS); err != nil {
			t.Fatalf("adding path: %v", err)
		}
		if err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:8080", SPKIHash: "h", Profile: "work"}); err != nil {
			t.Fatalf("starting Chrome: %v", err)
		}
		got := (*launches)[0]
		if got.Profile != "work" || !reflect.DeepEqual(got.Paths, []chrome.PathConfig{path}) {
			t.Fatalf("wanted: profile work with %v\ngot: %+v", path, got)
		}
	})
	t.Run("should refuse a profile that isn't configured", func(t *testing.T) {
		app := newProjectApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:8080", SPKIHash: "h", Profile: "missing"})
		if !errors.Is(err, service.ErrChromeNotFound) {
			t.Fatalf("wanted: %v\ngot: %v", service.ErrChromeNotFound, err)
		}
		if len(*launches) != 0 {
			t.Fatalf("wanted: no launch\ngot: %+v", *launches)
		}
	})
	t.Run("should refuse to start Chrome without the certificate's SPKI hash", func(t *testing.T) {
		app := newProjectApp(t)
		recordChromeLaunches(app)
		if err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:8080"}); err == nil {
			t.Fatal("wanted: an error\ngot: nil")
		}
	})

	t.Run("should start Chrome through the launcher without a CDP endpoint", func(t *testing.T) {
		if goruntime.GOOS == "windows" {
			t.Skip("test executable is a shell script")
		}
		app := newProjectApp(t)
		executable, argsPath := writeFakeChrome(t)
		if _, err := app.AddChromePath(executable, goruntime.GOOS); err != nil {
			t.Fatalf("adding fake Chrome: %v", err)
		}
		if err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:51390", SPKIHash: "spki-from-service"}); err != nil {
			t.Fatalf("starting Chrome: %v", err)
		}
		args := readFakeChromeArgs(t, argsPath)
		for _, want := range []string{"--proxy-server=http://127.0.0.1:51390\n", "--ignore-certificate-errors-spki-list=spki-from-service\n"} {
			if !strings.Contains(args, want) {
				t.Fatalf("wanted: %q among arguments\ngot:\n%s", want, args)
			}
		}
		if strings.Contains(args, "--remote-debugging-port") {
			t.Fatalf("wanted: no --remote-debugging-port among arguments\ngot:\n%s", args)
		}
	})
}

// recordChromeLaunches replaces app's Chrome launcher with one that records
// each launch instead of starting Chrome.
func recordChromeLaunches(app *App) *[]ChromeLaunch {
	launches := &[]ChromeLaunch{}
	app.launchChrome = func(launch ChromeLaunch) error {
		*launches = append(*launches, launch)
		return nil
	}
	return launches
}

// writeFakeChrome writes a Chrome stand-in that records its arguments, one
// per line, to argsPath.
func writeFakeChrome(t *testing.T) (executable, argsPath string) {
	t.Helper()
	dir := t.TempDir()
	argsPath = filepath.Join(dir, "args")
	executable = filepath.Join(dir, "chrome")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"" + argsPath + ".tmp\" && mv \"" + argsPath + ".tmp\" \"" + argsPath + "\"\n"
	if err := os.WriteFile(executable, []byte(script), 0700); err != nil {
		t.Fatalf("writing fake Chrome: %v", err)
	}
	return executable, argsPath
}

// readFakeChromeArgs waits for the fake Chrome to record its arguments.
func readFakeChromeArgs(t *testing.T, argsPath string) string {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		args, err := os.ReadFile(argsPath)
		if err == nil {
			return string(args)
		}
		if !time.Now().Before(deadline) {
			t.Fatalf("reading fake Chrome arguments: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// writeInvalidMaxMessageSize appends a negative websocket_max_message_size
// to the machine config that the app's Chrome settings reread.
func writeInvalidMaxMessageSize(t *testing.T, app *App) {
	t.Helper()
	path := filepath.Join(app.Proxy.ConfigDir, "marasi_config.yaml")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		t.Fatalf("opening config: %v", err)
	}
	defer file.Close()
	if _, err := file.WriteString("\nwebsocket_max_message_size: -1\n"); err != nil {
		t.Fatalf("writing config: %v", err)
	}
}

// newSharedConfigChrome stands in for a service instance using the app's config dir.
func newSharedConfigChrome(t *testing.T, app *App) *service.Chrome {
	t.Helper()
	proxy, err := marasi.New(
		marasi.WithLogger(slog.New(slog.NewTextHandler(io.Discard, nil))),
		marasi.WithConfigDir(app.Proxy.ConfigDir),
	)
	if err != nil {
		t.Fatalf("creating second proxy: %v", err)
	}
	return service.NewChrome(proxy, service.NewListenerLifecycle(proxy, io.Discard), io.Discard)
}
