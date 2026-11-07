package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	goruntime "runtime"
	"strings"
	"testing"
	"time"

	"github.com/tfkr-ae/marasi/chrome"
)

func TestAppChromeSettings(t *testing.T) {
	t.Run("should start with no paths and no profiles", func(t *testing.T) {
		app := newTestApp(t)
		paths, err := app.GetChromePaths()
		if err != nil || paths == nil || len(paths) != 0 {
			t.Fatalf("wanted: no paths\ngot: %#v, %v", paths, err)
		}
		profiles, err := app.GetChromeProfiles()
		if err != nil || profiles == nil || len(profiles) != 0 {
			t.Fatalf("wanted: no profiles\ngot: %#v, %v", profiles, err)
		}
	})

	t.Run("should keep paths and profiles in the app config across a reload", func(t *testing.T) {
		app := newTestApp(t)
		first := chrome.PathConfig{OS: "darwin", Path: "/Applications/Chrome.app"}
		second := chrome.PathConfig{OS: "linux", Path: "/usr/bin/google-chrome"}
		app.AddChromePath(first.Path, first.OS)
		paths, err := app.AddChromePath(second.Path, second.OS)
		if err != nil || !reflect.DeepEqual(paths, []chrome.PathConfig{first, second}) {
			t.Fatalf("wanted: %v\ngot: %v, %v", []chrome.PathConfig{first, second}, paths, err)
		}
		app.AddChromeProfile("work")
		profiles, err := app.AddChromeProfile(" client ")
		if err != nil || !reflect.DeepEqual(profiles, []string{"work", "client"}) {
			t.Fatalf("wanted: [work client]\ngot: %v, %v", profiles, err)
		}

		reloaded := newApp(app.Config.ConfigDir)
		if reloaded.Config, err = LoadConfig(app.Config.ConfigDir); err != nil {
			t.Fatalf("reloading: %v", err)
		}
		if got, _ := reloaded.GetChromePaths(); !reflect.DeepEqual(got, []chrome.PathConfig{first, second}) {
			t.Fatalf("wanted: %v after a reload\ngot: %v", []chrome.PathConfig{first, second}, got)
		}
		if got, _ := reloaded.GetChromeProfiles(); !reflect.DeepEqual(got, []string{"work", "client"}) {
			t.Fatalf("wanted: [work client] after a reload\ngot: %v", got)
		}
		text := appConfigText(t, app.Config.ConfigDir)
		for _, want := range []string{"chrome_paths:", "/usr/bin/google-chrome", "chrome_profiles:", "client"} {
			if !strings.Contains(text, want) {
				t.Fatalf("wanted: %q in marasi_appconfig.yaml\ngot:\n%s", want, text)
			}
		}
	})

	t.Run("should remove a path and leave the others", func(t *testing.T) {
		app := newTestApp(t)
		app.AddChromePath("/a", "darwin")
		app.AddChromePath("/b", "darwin")
		paths, err := app.DeleteChromePath("/a", "darwin")
		if err != nil || !reflect.DeepEqual(paths, []chrome.PathConfig{{OS: "darwin", Path: "/b"}}) {
			t.Fatalf("wanted: only /b\ngot: %v, %v", paths, err)
		}
	})

	t.Run("should remove a profile and its Chrome user data", func(t *testing.T) {
		app := newTestApp(t)
		app.AddChromeProfile("work")
		userData := filepath.Join(app.chromeConfigDir, "chrome_profiles", "work")
		if err := os.MkdirAll(filepath.Join(userData, "Default"), 0700); err != nil {
			t.Fatal(err)
		}
		profiles, err := app.DeleteChromeProfile("work")
		if err != nil || len(profiles) != 0 {
			t.Fatalf("wanted: no profiles\ngot: %v, %v", profiles, err)
		}
		if _, err := os.Stat(userData); !os.IsNotExist(err) {
			t.Fatalf("wanted: %s removed\ngot: %v", userData, err)
		}
	})

	t.Run("should refuse bad or repeated paths and profiles and change nothing", func(t *testing.T) {
		app := newTestApp(t)
		app.AddChromePath("/a", "darwin")
		app.AddChromeProfile("work")
		before := appConfigText(t, app.Config.ConfigDir)
		refusals := map[string]func() error{
			"a repeated path":     func() error { _, err := app.AddChromePath("/a", "darwin"); return err },
			"an empty path":       func() error { _, err := app.AddChromePath("", "darwin"); return err },
			"an unknown OS":       func() error { _, err := app.AddChromePath("/c", "plan9"); return err },
			"a missing path":      func() error { _, err := app.DeleteChromePath("/c", "darwin"); return err },
			"a repeated profile":  func() error { _, err := app.AddChromeProfile("work"); return err },
			"an empty profile":    func() error { _, err := app.AddChromeProfile("  "); return err },
			"a parent profile":    func() error { _, err := app.AddChromeProfile(".."); return err },
			"a nested profile":    func() error { _, err := app.AddChromeProfile("a/b"); return err },
			"a missing profile":   func() error { _, err := app.DeleteChromeProfile("home"); return err },
			"an escaping removal": func() error { _, err := app.DeleteChromeProfile("../work"); return err },
		}
		for name, call := range refusals {
			if err := call(); err == nil {
				t.Errorf("%s: wanted: an error\ngot: nil", name)
			}
		}
		if after := appConfigText(t, app.Config.ConfigDir); after != before {
			t.Fatalf("wanted: the app config unchanged\ngot:\n%s", after)
		}
	})
}

func TestAppChrome(t *testing.T) {
	t.Run("should aim Chrome at the local connection's proxy listener and pin its SPKI hash", func(t *testing.T) {
		app := newTestApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ConnectionURL: "http://127.0.0.1:51391", ProxyListener: "127.0.0.1:51390", SPKIHash: "spki-from-service"})
		if err != nil {
			t.Fatalf("starting Chrome: %v", err)
		}
		want := ChromeLaunch{Address: "127.0.0.1", Port: "51390", SPKIHash: "spki-from-service", ConfigDir: app.chromeConfigDir, Profile: "default-profile", Paths: []chrome.PathConfig{}}
		if len(*launches) != 1 || !reflect.DeepEqual((*launches)[0], want) {
			t.Fatalf("wanted: one launch %+v\ngot: %+v", want, *launches)
		}
	})
	t.Run("should aim Chrome at loopback when the local listener binds every address", func(t *testing.T) {
		app := newTestApp(t)
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
		app := newTestApp(t)
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
		app := newTestApp(t)
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
		app := newTestApp(t)
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
		app := newTestApp(t)
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
		app := newTestApp(t)
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
		app := newTestApp(t)
		launches := recordChromeLaunches(app)
		err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:8080", SPKIHash: "h", Profile: "missing"})
		if !errors.Is(err, errChromeNotFound) {
			t.Fatalf("wanted: %v\ngot: %v", errChromeNotFound, err)
		}
		if len(*launches) != 0 {
			t.Fatalf("wanted: no launch\ngot: %+v", *launches)
		}
	})
	t.Run("should code a launch the launcher couldn't start, keeping its cause", func(t *testing.T) {
		app := newTestApp(t)
		app.launchChrome = func(ChromeLaunch) error {
			return errors.New("finding Chrome executable: not found")
		}
		err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:8080", SPKIHash: "h"})
		if err == nil || !strings.Contains(err.Error(), "chrome_launch_failed (): finding Chrome executable: not found") {
			t.Fatalf("wanted: the launcher's error with the chrome_launch_failed code\ngot: %v", err)
		}
	})
	t.Run("should refuse to start Chrome without the certificate's SPKI hash", func(t *testing.T) {
		app := newTestApp(t)
		recordChromeLaunches(app)
		if err := app.StartBrowser(ChromeStart{ConnectionKind: "local", ProxyListener: "127.0.0.1:8080"}); err == nil {
			t.Fatal("wanted: an error\ngot: nil")
		}
	})

	t.Run("should start Chrome through the launcher without a CDP endpoint", func(t *testing.T) {
		if goruntime.GOOS == "windows" {
			t.Skip("test executable is a shell script")
		}
		app := newTestApp(t)
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
