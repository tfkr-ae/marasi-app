package main

import (
	"strings"
	"testing"
)

func TestFollowingAProjectWithNothingToLoseNeverAsks(t *testing.T) {
	app := newTestApp(t)
	dialog := withDialog(app, "Stay")

	confirmed, err := app.ConfirmFollowProject("other")
	if err != nil || !confirmed {
		t.Fatalf("wanted the load to go ahead, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no dialog, got %d", len(dialog.asked))
	}
}

func TestFollowingAProjectOverUnsavedDraftsNamesTheClientAndCanStay(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(1)
	dialog := withDialog(app, "Stay")

	confirmed, err := app.ConfirmFollowProject("other")
	if err != nil || confirmed {
		t.Fatalf("wanted Stay to decline the load, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	asked := dialog.asked[0]
	want := "Another client opened other. 1 launchpad has an unsaved draft. Load other will discard them."
	if asked.Message != want {
		t.Fatalf("message\n got %q\nwant %q", asked.Message, want)
	}
	if asked.Title != "Load other" || strings.Join(asked.Buttons, ",") != "Stay,Load other" || asked.CancelButton != "Stay" {
		t.Fatalf("wanted title Load other and buttons Stay, Load other; got %+v", asked)
	}
}

func TestFollowingAProjectOverLogbookEditsAsks(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedLogbookEdits(true)
	dialog := withDialog(app, "Load other")

	confirmed, err := app.ConfirmFollowProject("other")
	if err != nil || !confirmed {
		t.Fatalf("wanted Load other to confirm, got %v %v", confirmed, err)
	}
	want := "Another client opened other. The Logbook has unsaved edits. Load other will discard them."
	if len(dialog.asked) != 1 || dialog.asked[0].Message != want {
		t.Fatalf("wanted %q, got %v", want, dialog.asked)
	}
}

func TestServerDialogAnswersTheStubbedButtonOrDismisses(t *testing.T) {
	options := messageDialogOptions{Buttons: []string{"Stay", "Load other"}, CancelButton: "Stay"}
	if got := serverDialogAnswer(options, "Load other"); got != "Load other" {
		t.Fatalf("wanted the stubbed button, got %q", got)
	}
	if got := serverDialogAnswer(options, "Nope"); got != "Stay" {
		t.Fatalf("wanted the cancel button for an unknown answer, got %q", got)
	}
	if got := serverDialogAnswer(options, ""); got != "Stay" {
		t.Fatalf("wanted the cancel button without a stub, got %q", got)
	}
}
