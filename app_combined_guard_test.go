package main

import (
	"strings"
	"testing"
	"time"
)

// fakeArmoryFrontend stands in for the frontend's Armory: it reports active
// runs, and answers each cancelArmoryRunsEvent through ArmoryRunsCancelled
// with problem ("" when the runs stopped), unless silent.
type fakeArmoryFrontend struct {
	app     *App
	problem string
	silent  bool
	asked   int
}

func (f *fakeArmoryFrontend) emit(name string, _ ...any) {
	if name != cancelArmoryRunsEvent {
		return
	}
	f.asked++
	if f.silent {
		return
	}
	go func() {
		if f.problem == "" {
			f.app.SetActiveArmoryRunCount(0)
		}
		f.app.ArmoryRunsCancelled(f.problem)
	}()
}

func appWithDraftsAndArmoryRuns(drafts int) (*App, *fakeArmoryFrontend) {
	app := &App{}
	frontend := &fakeArmoryFrontend{app: app}
	app.emitEvent = frontend.emit
	app.SetUnsavedDraftCount(drafts)
	app.SetActiveArmoryRunCount(1)
	return app, frontend
}

func TestQuitWithDraftsAndArmoryRunsAsksOnceAboutBoth(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(2)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted cancelling the dialog to keep Marasi open")
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	message := dialog.asked[0].Message
	if !strings.Contains(message, "2 launchpads have unsaved drafts") || !strings.Contains(message, "Armory runs") {
		t.Fatalf("wanted drafts and Armory runs in one message, got %q", message)
	}
	if frontend.asked != 0 {
		t.Fatal("wanted the Armory run left running")
	}
}

func TestQuitWithOnlyArmoryRunsAsks(t *testing.T) {
	app, _ := appWithDraftsAndArmoryRuns(0)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted cancelling the dialog to keep Marasi open")
	}
	if len(dialog.asked) != 1 || !strings.Contains(dialog.asked[0].Message, "cancel all active Armory runs") {
		t.Fatalf("wanted one dialog about the Armory runs, got %+v", dialog.asked)
	}
}

func TestQuitConfirmedOverDraftsAndArmoryRunsCancelsRunsAfterOneDialog(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(1)
	dialog := withDialog(app, "Close Marasi")

	if prevent := app.beforeClose(); prevent {
		t.Fatal("wanted confirming the dialog to close Marasi")
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	if frontend.asked != 1 {
		t.Fatalf("wanted the frontend asked once to cancel the runs, got %d", frontend.asked)
	}
}

func TestQuitStaysOpenWhenTheRunsWontCancel(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(0)
	frontend.problem = "timed out cancelling active Armory runs"
	withDialog(app, "Close Marasi")

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted Marasi kept open when the runs didn't stop")
	}
}

func TestQuitStaysOpenWhenTheFrontendNeverAnswers(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(0)
	frontend.silent = true
	app.armoryCancelTimeout = 20 * time.Millisecond
	withDialog(app, "Close Marasi")

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted Marasi kept open when no answer came")
	}
}

func TestSwitchProjectWithDraftsAndArmoryRunsAsksOnce(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(3)
	dialog := withDialog(app, "Cancel")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || confirmed {
		t.Fatalf("wanted the switch cancelled, got %v %v", confirmed, err)
	}
	if len(dialog.asked) != 1 {
		t.Fatalf("wanted one dialog, got %d", len(dialog.asked))
	}
	if frontend.asked != 0 {
		t.Fatal("wanted the Armory run left running")
	}
}

func TestSwitchProjectConfirmedOverArmoryRunsCancelsThemFirst(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(0)
	withDialog(app, "Switch Project")

	confirmed, err := app.ConfirmProjectSwitch()
	if err != nil || !confirmed {
		t.Fatalf("wanted the switch to go ahead, got %v %v", confirmed, err)
	}
	if frontend.asked != 1 {
		t.Fatalf("wanted the frontend asked once to cancel the runs, got %d", frontend.asked)
	}
}

func TestSwitchProjectRefusedWhenTheRunsWontCancel(t *testing.T) {
	app, frontend := appWithDraftsAndArmoryRuns(0)
	frontend.problem = "POST /armory/run/r1/cancel: internal_server_error: HTTP 500"
	withDialog(app, "Switch Project")

	confirmed, err := app.ConfirmProjectSwitch()
	if confirmed || err == nil || !strings.Contains(err.Error(), "internal_server_error") {
		t.Fatalf("wanted the switch refused with the frontend's problem, got %v %v", confirmed, err)
	}
}

func TestALateCancelAnswerIsIgnored(t *testing.T) {
	app := &App{}
	app.ArmoryRunsCancelled("")
	app.SetActiveArmoryRunCount(0)
	if app.hasWorkToLose() {
		t.Fatal("wanted nothing to lose")
	}
}
