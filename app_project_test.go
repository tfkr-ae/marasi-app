package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/service"
	"github.com/tfkr-ae/marasi/wordlist"
	"github.com/wailsapp/wails/v2/pkg/runtime"
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

// A project another Marasi owns refuses with the project_locked code, and
// the project the app had open stays open and owned by the app.
func TestOpenProjectRefusesLockedProjectAndKeepsOpenProject(t *testing.T) {
	app := newScratchpadApp(t)
	holder := newDetachedProjectLifecycle(t)
	if err := holder.Open(context.Background(), projectPath(t, app, "locked.marasi")); err != nil {
		t.Fatalf("holding locked project: %v", err)
	}

	_, err := app.OpenProject("locked")
	if err == nil || !strings.Contains(err.Error(), "project_locked") {
		t.Fatalf("wanted a project_locked error, got %v", err)
	}
	assertProjectOwned(t, scratchpadPath(t, app))
	if app.Proxy.TrafficRepo == nil {
		t.Fatal("wanted the scratchpad's repositories still published")
	}
}

// With the scratchpad owned by another Marasi, opening it refuses with the
// project_locked code too.
func TestSetupScratchpadRefusesLockedScratchpad(t *testing.T) {
	app := newProjectApp(t)
	holder := newDetachedProjectLifecycle(t)
	if err := holder.Open(context.Background(), scratchpadPath(t, app)); err != nil {
		t.Fatalf("holding scratchpad: %v", err)
	}

	err := app.SetupScratchpad()
	if err == nil || !strings.Contains(err.Error(), "project_locked") {
		t.Fatalf("wanted a project_locked error, got %v", err)
	}
}

// The frontend shows the scratchpad's file path before it opens.
func TestScratchpadPathIsTheScratchpadSetupOpens(t *testing.T) {
	app := newProjectApp(t)
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	got, err := service.ResolveProjectPath(app.ScratchpadPath())
	if err != nil {
		t.Fatalf("resolving %q: %v", app.ScratchpadPath(), err)
	}
	if want := scratchpadPath(t, app); got != want {
		t.Fatalf("wanted scratchpad path %q, got %q", want, got)
	}
}

// A held Checkpoint item refuses the switch with the checkpoint_held code
// naming it, before the unsaved-work prompt and the opening screen. The open
// project and the held item stay as they were, and once the item is dropped
// the switch goes through.
func TestOpenProjectRefusesWhileCheckpointItemHeld(t *testing.T) {
	app := newCheckpointApp(t)
	events := &recordedEvents{}
	app.emitEvent = events.emit
	app.messageDialog = func(runtime.MessageDialogOptions) (string, error) {
		t.Fatal("wanted no unsaved-work prompt while an item is held")
		return "", nil
	}
	app.unsavedDrafts.Store(1)
	oldPath := scratchpadPath(t, app)
	_, reqID, done := startAppRequestHold(t, app)
	waitForAppCheckpoint(t, app, 1)

	_, err := app.OpenProject("other")
	if err == nil || !strings.Contains(err.Error(), checkpointHeld+" ("+reqID.String()+")") {
		t.Fatalf("wanted a checkpoint_held error naming %s, got %v", reqID, err)
	}
	if _, ok := events.first(projectOpeningEvent); ok {
		t.Fatal("wanted no project-opening event for a refused switch")
	}
	assertProjectOwned(t, oldPath)
	if items := app.GetCheckpointItems(); len(items) != 1 || items[0].ID != reqID {
		t.Fatalf("wanted the item still held, got %v", items)
	}

	if err := app.DropCheckpoint(reqID); err != nil {
		t.Fatalf("dropping checkpoint: %v", err)
	}
	if err := receiveAppHoldResult(t, done); !errors.Is(err, marasi.ErrDropped) {
		t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
	}
	app.unsavedDrafts.Store(0)
	if name, err := app.OpenProject("other"); err != nil || name != "other" {
		t.Fatalf("wanted switch to other once the item was dropped, got %q %v", name, err)
	}
	assertProjectOwned(t, projectPath(t, app, "other.marasi"))
	assertProjectReleased(t, oldPath)
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
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	return app
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
