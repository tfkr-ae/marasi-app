package main

import (
	"strings"
	"testing"

)

// fakeDialog answers every message dialog with answer and records what was asked.
type fakeDialog struct {
	answer string
	asked  []messageDialogOptions
}

func (d *fakeDialog) show(options messageDialogOptions) (string, error) {
	d.asked = append(d.asked, options)
	return d.answer, nil
}

func withDialog(app *App, answer string) *fakeDialog {
	dialog := &fakeDialog{answer: answer}
	app.messageDialog = dialog.show
	return dialog
}

func TestQuitWithoutUnsavedDraftsDoesNotAsk(t *testing.T) {
	app := newTestApp(t)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(); prevent {
		t.Fatal("wanted close to go ahead")
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no dialog, got %d", len(dialog.asked))
	}
}

func TestQuitWithUnsavedDraftsAsksOnceWithTheCount(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(3)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(); !prevent {
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
	app := newTestApp(t)
	app.SetUnsavedDraftCount(1)
	dialog := withDialog(app, "Cancel")

	app.beforeClose()
	if !strings.Contains(dialog.asked[0].Message, "1 launchpad has an unsaved draft") {
		t.Fatalf("wanted the singular message, got %q", dialog.asked[0].Message)
	}
}

func TestQuitConfirmedOverUnsavedDraftsCloses(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(2)
	withDialog(app, "Close Marasi")

	if prevent := app.beforeClose(); prevent {
		t.Fatal("wanted confirming the dialog to close Marasi")
	}
}

func TestSwitchProjectOverUnsavedDraftsCanBeCancelled(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(2)
	dialog := withDialog(app, "Cancel")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || confirmed {
		t.Fatalf("wanted the switch cancelled, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "2 launchpads have unsaved drafts") {
		t.Fatalf("wanted one dialog naming the drafts, got %v", dialog.asked)
	}
}

func TestSwitchProjectConfirmedOverUnsavedDrafts(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(2)
	withDialog(app, "Switch Project")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || !confirmed {
		t.Fatalf("wanted the switch confirmed, got %v %v", confirmed, err)
	}
}

func TestSwitchProjectWithNothingToLoseNeverAsks(t *testing.T) {
	app := newTestApp(t)
	dialog := withDialog(app, "Cancel")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || !confirmed {
		t.Fatalf("wanted the switch to go ahead, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 0 {
		t.Fatalf("wanted no dialog, got %d", len(dialog.asked))
	}
}

func TestSwitchProjectOverUnsavedLogbookEditsAsks(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedLogbookEdits(true)
	dialog := withDialog(app, "Cancel")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || confirmed {
		t.Fatalf("wanted the switch cancelled, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "The Logbook has unsaved edits") {
		t.Fatalf("wanted one dialog naming the Logbook edits, got %v", dialog.asked)
	}
}

func TestQuitOverUnsavedLogbookEditsAsks(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedLogbookEdits(true)
	dialog := withDialog(app, "Cancel")

	if !app.hasWorkToLose() {
		t.Fatal("wanted unsaved Logbook edits to count as work to lose")
	}
	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted cancelling the dialog to keep Marasi open")
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "The Logbook has unsaved edits") {
		t.Fatalf("wanted one dialog naming the Logbook edits, got %v", dialog.asked)
	}
}

func TestSavedLogbookEditsNoLongerAsk(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedLogbookEdits(true)
	app.SetUnsavedLogbookEdits(false)
	dialog := withDialog(app, "Cancel")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || !confirmed || len(dialog.asked) != 0 {
		t.Fatalf("wanted the switch to go ahead without asking, got %v %v %v", confirmed, err, dialog.asked)
	}
}

func TestFollowProjectNamesReportedLogbookEdits(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedLogbookEdits(true)
	dialog := withDialog(app, "Stay")

	confirmed, err := app.ConfirmFollowProject("other")
	if err != nil || confirmed {
		t.Fatalf("wanted Stay, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "The Logbook has unsaved edits. Load other will discard them.") {
		t.Fatalf("wanted the follow prompt to name the Logbook edits, got %v", dialog.asked)
	}
}
