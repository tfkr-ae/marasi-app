package main

import (
	"strings"
	"testing"
)

func TestSwitchProjectWithOpenDrawingsAsksOnceAndCancelKeepsThem(t *testing.T) {
	app := newTestApp(t)
	app.SetOpenToolDocuments("drawing", 2)
	dialog := withDialog(app, "Cancel")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || confirmed {
		t.Fatalf("wanted the switch cancelled, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "2 drawings exist only in memory") {
		t.Fatalf("wanted one dialog naming the drawings, got %v", dialog.asked)
	}
}

func TestQuitWithOneOpenDrawingAsksInTheSingular(t *testing.T) {
	app := newTestApp(t)
	app.SetOpenToolDocuments("drawing", 1)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted cancelling the dialog to keep Marasi open")
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "1 drawing exists only in memory") {
		t.Fatalf("wanted one dialog naming the drawing, got %v", dialog.asked)
	}
}

func TestDraftsAndDrawingsShareOneDialog(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(1)
	app.SetOpenToolDocuments("drawing", 3)
	dialog := withDialog(app, "Cancel")

	app.ConfirmProjectSwitch()
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	message := dialog.asked[0].Message
	if !strings.Contains(message, "1 launchpad has an unsaved draft") || !strings.Contains(message, "3 drawings exist only in memory") {
		t.Fatalf("wanted the drafts and drawings named together, got %q", message)
	}
}

func TestDocumentKindsAreNamedTogether(t *testing.T) {
	app := newTestApp(t)
	app.SetOpenToolDocuments("recipe", 1)
	app.SetOpenToolDocuments("drawing", 2)
	dialog := withDialog(app, "Cancel")

	app.ConfirmProjectSwitch()
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "2 drawings and 1 recipe exist only in memory") {
		t.Fatalf("wanted both kinds in one sentence, got %v", dialog.asked)
	}
}

func TestNoOpenDrawingsNeverAsks(t *testing.T) {
	app := newTestApp(t)
	app.SetOpenToolDocuments("drawing", 2)
	app.SetOpenToolDocuments("drawing", 0)
	dialog := withDialog(app, "Cancel")

	if app.hasWorkToLose() {
		t.Fatal("wanted no work to lose once the drawings are empty")
	}
	if confirmed, _ := app.ConfirmProjectSwitch(); !confirmed || len(dialog.asked) != 0 {
		t.Fatalf("wanted the switch without asking, got %v and %d dialogs", confirmed, len(dialog.asked))
	}
}
