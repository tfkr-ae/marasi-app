package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"

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
		if paths := app.GetChromePaths(); !slices.Contains(paths, added) {
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
		paths := app.AddChromePath(fromApp.Path, fromApp.OS)
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
		if profiles := app.GetChromeProfiles(); !slices.Contains(profiles, "service-profile") {
			t.Fatalf("wanted: service-profile in profiles\ngot: %v", profiles)
		}
	})

	t.Run("should refuse to start Chrome while the proxy is stopped", func(t *testing.T) {
		app := newProjectApp(t)
		if err := app.StartBrowser(""); !errors.Is(err, service.ErrListenerInactive) {
			t.Fatalf("wanted: %v\ngot: %v", service.ErrListenerInactive, err)
		}
	})
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
