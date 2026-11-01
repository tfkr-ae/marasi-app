package main

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
)

// cancellableArmory reports active runs until CancelRun removes them.
type cancellableArmory struct {
	activeArmoryService
}

func (service *cancellableArmory) CancelRun(id uuid.UUID) error {
	kept := service.ids[:0]
	for _, active := range service.ids {
		if active != id {
			kept = append(kept, active)
		}
	}
	service.ids = kept
	return nil
}

func appWithDraftsAndArmoryRuns(drafts int) (*App, *cancellableArmory) {
	armory := &cancellableArmory{activeArmoryService{ids: []uuid.UUID{uuid.Must(uuid.NewV7())}}}
	app := &App{Proxy: &marasi.Proxy{Armory: armory}}
	app.SetUnsavedDraftCount(drafts)
	return app, armory
}

func TestQuitWithDraftsAndArmoryRunsAsksOnceAboutBoth(t *testing.T) {
	app, armory := appWithDraftsAndArmoryRuns(2)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(context.Background()); !prevent {
		t.Fatal("wanted cancelling the dialog to keep Marasi open")
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	message := dialog.asked[0].Message
	if !strings.Contains(message, "2 launchpads have unsaved drafts") || !strings.Contains(message, "Armory runs") {
		t.Fatalf("wanted drafts and Armory runs in one message, got %q", message)
	}
	if len(armory.ids) != 1 {
		t.Fatal("wanted the Armory run left running")
	}
}

func TestQuitConfirmedOverDraftsAndArmoryRunsCancelsRunsAfterOneDialog(t *testing.T) {
	app, armory := appWithDraftsAndArmoryRuns(1)
	dialog := withDialog(app, "Close Marasi")

	if prevent := app.beforeClose(context.Background()); prevent {
		t.Fatal("wanted confirming the dialog to close Marasi")
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	if len(armory.ids) != 0 {
		t.Fatal("wanted the Armory runs cancelled")
	}
}

func TestSwitchProjectWithDraftsAndArmoryRunsAsksOnce(t *testing.T) {
	app, armory := appWithDraftsAndArmoryRuns(3)
	dialog := withDialog(app, "Cancel")

	_, err := app.OpenProject("/tmp/other")
	if err == nil || !strings.Contains(err.Error(), "project switch cancelled") {
		t.Fatalf("wanted project switch cancelled, got %v", err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	if len(armory.ids) != 1 {
		t.Fatal("wanted the Armory run left running")
	}
}
