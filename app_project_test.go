package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/service"
	"github.com/tfkr-ae/marasi/wordlist"
)

// Opening projects moved to the service (projectStore.test.js); the pages
// not yet on the service still open them in process for their tests.

func TestCloseReleasesOpenProject(t *testing.T) {
	app := newProjectApp(t)
	if err := app.setupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	path := scratchpadPath(t, app)
	assertProjectOwned(t, path)
	app.ServiceShutdown()
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
		marasi.WithBasePipeline(),
		marasi.WithDefaultModifierPipeline(),
	)
	if err != nil {
		t.Fatalf("creating proxy: %v", err)
	}
	app := newApp(proxy, configDir, manager, io.Discard, logger)
	if app.Config, err = LoadConfig(configDir); err != nil {
		t.Fatalf("loading app config: %v", err)
	}
	t.Cleanup(func() {
		if err := app.listener.Shutdown(); err != nil {
			t.Fatalf("shutting down listener: %v", err)
		}
		if err := app.projects.Shutdown(); err != nil {
			t.Fatalf("releasing open project: %v", err)
		}
	})
	return app
}

func newScratchpadApp(t *testing.T) *App {
	t.Helper()
	app := newProjectApp(t)
	if err := app.setupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	return app
}

// openTestProject opens the project named name, or at an absolute path,
// in process.
func openTestProject(t *testing.T, app *App, name string) {
	t.Helper()
	path := name
	if !filepath.IsAbs(name) {
		path = filepath.Join(app.Proxy.ConfigDir, name+".marasi")
	}
	if err := app.openInProcess(path); err != nil {
		t.Fatalf("opening %s: %v", name, err)
	}
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
