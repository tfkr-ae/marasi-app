package main

import (
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/tfkr-ae/marasi/db"
)

func TestSetupScratchpadGivesStartupTheGUI(t *testing.T) {
	app := newProjectApp(t)
	events := &recordedEvents{}
	app.emitEvent = events.emit
	seedWorkshopLua(t, filepath.Join(app.Proxy.ConfigDir, "scratchpad.marasi"), `function startup() marasi.gui:render("toast", {}) end`)
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	if !events.has("extension_gui_render") {
		t.Fatal("wanted extension_gui_render event for the startup toast")
	}
}

// seedWorkshopLua stores code as the workshop extension of the project at path
// before any service instance opens it.
func seedWorkshopLua(t *testing.T, path, code string) {
	t.Helper()
	conn, err := db.New(path, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("creating project: %v", err)
	}
	defer conn.Close()
	repo := db.NewProxyRepo(conn)
	workshop, err := repo.GetExtensionByName("workshop")
	if err != nil {
		t.Fatalf("finding workshop: %v", err)
	}
	if err := repo.UpdateExtensionLuaCodeByUUID(workshop.ID, code); err != nil {
		t.Fatalf("storing workshop code: %v", err)
	}
}
