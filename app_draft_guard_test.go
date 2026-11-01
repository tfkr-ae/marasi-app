package main

import (
	"context"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// fakeDialog answers every message dialog with answer and records what was asked.
type fakeDialog struct {
	answer string
	asked  []runtime.MessageDialogOptions
}

func (d *fakeDialog) show(options runtime.MessageDialogOptions) (string, error) {
	d.asked = append(d.asked, options)
	return d.answer, nil
}

func withDialog(app *App, answer string) *fakeDialog {
	dialog := &fakeDialog{answer: answer}
	app.messageDialog = dialog.show
	return dialog
}

func TestQuitWithoutUnsavedDraftsDoesNotAsk(t *testing.T) {
	app := newScratchpadApp(t)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(context.Background()); prevent {
		t.Fatal("wanted close to go ahead")
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no dialog, got %d", len(dialog.asked))
	}
}

func TestQuitWithUnsavedDraftsAsksOnceWithTheCount(t *testing.T) {
	app := newScratchpadApp(t)
	app.SetUnsavedDraftCount(3)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(context.Background()); !prevent {
		t.Fatal("wanted cancelling the dialog to keep Marasi open")
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	if !strings.Contains(dialog.asked[0].Message, "3 launchpads have unsaved drafts") {
		t.Fatalf("wanted the draft count in the message, got %q", dialog.asked[0].Message)
	}
}

func TestQuitWithOneUnsavedDraftUsesTheSingular(t *testing.T) {
	app := newScratchpadApp(t)
	app.SetUnsavedDraftCount(1)
	dialog := withDialog(app, "Cancel")

	app.beforeClose(context.Background())
	if !strings.Contains(dialog.asked[0].Message, "1 launchpad has an unsaved draft") {
		t.Fatalf("wanted the singular message, got %q", dialog.asked[0].Message)
	}
}

func TestQuitConfirmedOverUnsavedDraftsCloses(t *testing.T) {
	app := newScratchpadApp(t)
	app.SetUnsavedDraftCount(2)
	withDialog(app, "Close Marasi")

	if prevent := app.beforeClose(context.Background()); prevent {
		t.Fatal("wanted confirming the dialog to close Marasi")
	}
}

func TestSwitchProjectOverUnsavedDraftsCanBeCancelled(t *testing.T) {
	app := newScratchpadApp(t)
	oldPath := scratchpadPath(t, app)
	app.SetUnsavedDraftCount(2)
	dialog := withDialog(app, "Cancel")

	_, err := app.OpenProject("other")
	if err == nil || !strings.Contains(err.Error(), "project switch cancelled") {
		t.Fatalf("wanted project switch cancelled, got %v", err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	assertProjectOwned(t, oldPath)
}

func TestSwitchProjectConfirmedOverUnsavedDraftsDiscardsThem(t *testing.T) {
	app := newScratchpadApp(t)
	oldPath := scratchpadPath(t, app)
	app.SetUnsavedDraftCount(2)
	withDialog(app, "Switch Project")

	if _, err := app.OpenProject("other"); err != nil {
		t.Fatalf("opening other project: %v", err)
	}
	assertProjectReleased(t, oldPath)

	// The drafts went with the old project, so quitting no longer asks.
	dialog := withDialog(app, "Cancel")
	if prevent := app.beforeClose(context.Background()); prevent {
		t.Fatal("wanted close to go ahead")
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no dialog, got %d", len(dialog.asked))
	}
}

// A switch cancelled at the unsaved-work prompt never starts opening, so the
// frontend's opening screen stays away; a confirmed one says it has started.
func TestSwitchProjectCancelledAtThePromptNeverStartsOpening(t *testing.T) {
	app := newScratchpadApp(t)
	events := &recordedEvents{}
	app.emitEvent = events.emit
	app.SetUnsavedDraftCount(2)
	withDialog(app, "Cancel")

	app.OpenProject("other")
	if _, ok := events.first(projectOpeningEvent); ok {
		t.Fatalf("wanted no %s event for a cancelled switch", projectOpeningEvent)
	}
}

func TestSwitchProjectConfirmedAtThePromptStartsOpening(t *testing.T) {
	app := newScratchpadApp(t)
	events := &recordedEvents{}
	app.emitEvent = events.emit
	app.SetUnsavedDraftCount(2)
	withDialog(app, "Switch Project")

	if _, err := app.OpenProject("other"); err != nil {
		t.Fatalf("opening other project: %v", err)
	}
	if _, ok := events.first(projectOpeningEvent); !ok {
		t.Fatalf("wanted a %s event once the switch was confirmed", projectOpeningEvent)
	}
}
