package main

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// withNativeDialog shows dialogs as goos would, through a fake that answers
// answer, as Wails does on platforms without custom buttons.
func withNativeDialog(app *App, goos, answer string) *fakeDialog {
	dialog := &fakeDialog{answer: answer}
	app.messageDialog = nativeMessageDialog(goos, dialog.show)
	return dialog
}

func TestConfirmingOnWindowsAndLinuxAsksYesOrNo(t *testing.T) {
	for _, goos := range []string{"windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			app := &App{}
			dialog := withNativeDialog(app, goos, "Yes")

			if !app.confirm("Reinstall latest release", "Continue?") {
				t.Fatalf("wanted Yes to confirm")
			}
			question := dialog.asked[0]
			if question.Type != runtime.QuestionDialog || len(question.Buttons) != 0 || question.DefaultButton != "No" {
				t.Fatalf("wanted a Yes/No question defaulting to No, got %+v", question)
			}
			if question.Title != "Reinstall latest release" || question.Message != "Continue?" {
				t.Fatalf("wanted the title and message kept, got %+v", question)
			}
		})
	}
}

func TestAnsweringNoOnWindowsCancels(t *testing.T) {
	app := &App{}
	withNativeDialog(app, "windows", "No")

	if app.confirm("Close Marasi", "Continue?") {
		t.Fatalf("wanted No to cancel")
	}
}

func TestConfirmingOnMacOSKeepsTheCustomButtons(t *testing.T) {
	app := &App{}
	dialog := withNativeDialog(app, "darwin", "Close Marasi")

	if !app.confirm("Close Marasi", "Continue?") {
		t.Fatalf("wanted the action button to confirm")
	}
	if warning := dialog.asked[0]; warning.Type != runtime.WarningDialog || len(warning.Buttons) != 2 {
		t.Fatalf("wanted the Cancel and Close Marasi warning, got %+v", warning)
	}
}

func TestOtherDialogsPassThroughUnchanged(t *testing.T) {
	dialog := &fakeDialog{answer: "Ok"}
	show := nativeMessageDialog("windows", dialog.show)

	info := runtime.MessageDialogOptions{Type: runtime.InfoDialog, Title: "Saved", Message: "Done."}
	if result, err := show(info); err != nil || result != "Ok" {
		t.Fatalf("wanted Ok, got %q (%v)", result, err)
	}
	if got := dialog.asked[0]; got.Type != runtime.InfoDialog || got.Title != "Saved" {
		t.Fatalf("wanted the dialog unchanged, got %+v", got)
	}
}
