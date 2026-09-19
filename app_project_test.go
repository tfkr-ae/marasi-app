package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/service"
	"github.com/tfkr-ae/marasi/wordlist"
)

func TestSetupScratchpadOpensThroughLifecycle(t *testing.T) {
	app := newProjectApp(t)
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	path := scratchpadPath(t, app)
	assertProjectOwned(t, path)
	if app.Proxy.TrafficRepo == nil || app.Proxy.Armory == nil {
		t.Fatal("wanted scratchpad repositories published")
	}
}

func TestOpenProjectSwitchesThroughLifecycle(t *testing.T) {
	app := newProjectApp(t)
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	oldPath := scratchpadPath(t, app)
	name, err := app.OpenProject("other")
	if err != nil {
		t.Fatalf("opening other project: %v", err)
	}
	if name != "other" {
		t.Fatalf("wanted project name other, got %q", name)
	}
	assertProjectOwned(t, projectPath(t, app, "other.marasi"))
	assertProjectReleased(t, oldPath)
}

func TestOpenProjectSurfacesProjectBusy(t *testing.T) {
	app := newCheckpointApp(t)
	oldPath := scratchpadPath(t, app)
	oldRepo := app.Proxy.TrafficRepo
	_, reqID, done := startAppRequestHold(t, app)
	waitForAppCheckpoint(t, app, 1)

	name, err := app.OpenProject("other")
	if !errors.Is(err, service.ErrProjectBusy) {
		t.Fatalf("wanted %v, got %q %v", service.ErrProjectBusy, name, err)
	}
	assertProjectOwned(t, oldPath)
	if app.Proxy.TrafficRepo != oldRepo {
		t.Fatal("wanted old project repositories left in place")
	}
	if !app.Proxy.HasPendingCheckpoint() {
		t.Fatal("wanted pending checkpoint left untouched")
	}
	select {
	case <-done:
		t.Fatal("wanted checkpoint still waiting")
	default:
	}
	if err := app.DropCheckpoint(reqID); err != nil {
		t.Fatalf("dropping checkpoint: %v", err)
	}
	if err := receiveAppHoldResult(t, done); !errors.Is(err, marasi.ErrDropped) {
		t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
	}
}

func TestCloseReleasesOpenProject(t *testing.T) {
	app := newProjectApp(t)
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	path := scratchpadPath(t, app)
	assertProjectOwned(t, path)
	app.close(context.Background())
	assertProjectReleased(t, path)
}

func newProjectApp(t *testing.T) *App {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	configDir := t.TempDir()
	manager, err := wordlist.NewManager(configDir)
	if err != nil {
		t.Fatalf("creating wordlist manager: %v", err)
	}
	proxy, err := marasi.New(
		marasi.WithLogger(logger),
		marasi.WithConfigDir(configDir),
		marasi.WithWordlistManager(manager),
		marasi.WithRequestHandler(func(domain.ProxyRequest) error { return nil }),
		marasi.WithResponseHandler(func(domain.ProxyResponse) error { return nil }),
		marasi.WithLogHandler(func(domain.Log) error { return nil }),
		marasi.WithBasePipeline(),
		marasi.WithDefaultModifierPipeline(),
	)
	if err != nil {
		t.Fatalf("creating proxy: %v", err)
	}
	listener := service.NewListenerLifecycle(proxy, io.Discard)
	projects := service.NewProjectLifecycle(proxy, configDir, manager, logger)
	t.Cleanup(func() {
		if err := listener.Shutdown(); err != nil {
			t.Fatalf("shutting down listener: %v", err)
		}
		if err := projects.Shutdown(); err != nil {
			t.Fatalf("releasing open project: %v", err)
		}
	})
	return &App{Proxy: proxy, listener: listener, projects: projects}
}

func scratchpadPath(t *testing.T, app *App) string {
	t.Helper()
	return projectPath(t, app, "scratchpad.marasi")
}

func projectPath(t *testing.T, app *App, name string) string {
	t.Helper()
	path, err := service.ResolveProjectPath(filepath.Join(app.Proxy.ConfigDir, name))
	if err != nil {
		t.Fatalf("resolving %s: %v", name, err)
	}
	return path
}

func assertProjectOwned(t *testing.T, path string) {
	t.Helper()
	lifecycle := newDetachedProjectLifecycle(t)
	if err := lifecycle.Open(context.Background(), path); !errors.Is(err, service.ErrProjectAlreadyOpen) {
		t.Fatalf("wanted %v for %s, got %v", service.ErrProjectAlreadyOpen, path, err)
	}
}

func assertProjectReleased(t *testing.T, path string) {
	t.Helper()
	lifecycle := newDetachedProjectLifecycle(t)
	if err := lifecycle.Open(context.Background(), path); err != nil {
		t.Fatalf("opening released project %s: %v", path, err)
	}
}

func newDetachedProjectLifecycle(t *testing.T) *service.ProjectLifecycle {
	t.Helper()
	configDir := t.TempDir()
	manager, err := wordlist.NewManager(configDir)
	if err != nil {
		t.Fatalf("creating wordlist manager: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proxy, err := marasi.New(marasi.WithLogger(logger), marasi.WithConfigDir(configDir))
	if err != nil {
		t.Fatalf("creating proxy: %v", err)
	}
	lifecycle := service.NewProjectLifecycle(proxy, configDir, manager, logger)
	t.Cleanup(func() {
		if err := lifecycle.Shutdown(); err != nil {
			t.Fatalf("releasing detached project: %v", err)
		}
	})
	return lifecycle
}
