package main

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

// Desktop calls (dialogs, the clipboard, events, quitting) go through App's
// replaceable functions, so these tests replace them instead of the runtime.

// cancellingFileDialogs answers every open and save dialog as a cancel and
// counts them.
type cancellingFileDialogs struct{ shown int }

func withCancelledFileDialogs(app *App) *cancellingFileDialogs {
	dialogs := &cancellingFileDialogs{}
	app.openFileDialog = func(openDialogOptions) (string, error) {
		dialogs.shown++
		return "", nil
	}
	app.saveFileDialog = func(saveDialogOptions) (string, error) {
		dialogs.shown++
		return "", nil
	}
	return dialogs
}

func TestCancellingAFileDialogDoesNothing(t *testing.T) {
	t.Run("choosing a project", func(t *testing.T) {
		app := newTestApp(t)
		dialogs := withCancelledFileDialogs(app)
		if path, err := app.OpenFileDialog(); path != "" || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted no path after one dialog, got %q %v (%d dialogs)", path, err, dialogs.shown)
		}
	})

	t.Run("exporting a keybinding profile", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)
		dialogs := withCancelledFileDialogs(app)
		path, err := app.ExportKeybindingProfile("work.json", "{}")
		if path != "" || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted no path after one dialog, got %q %v (%d dialogs)", path, err, dialogs.shown)
		}
		if written, _ := filepath.Glob(filepath.Join(dir, "*.json")); len(written) != 0 {
			t.Fatalf("wanted no profile written, got %v", written)
		}
	})

	t.Run("importing a keybinding profile", func(t *testing.T) {
		app := loadConfigApp(t, t.TempDir())
		dialogs := withCancelledFileDialogs(app)
		if file, err := app.ImportKeybindingProfile(); file != (KeybindingProfileFile{}) || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted no file after one dialog, got %+v %v (%d dialogs)", file, err, dialogs.shown)
		}
	})

	t.Run("choosing an upstream proxy CA", func(t *testing.T) {
		app := newTestApp(t)
		dialogs := withCancelledFileDialogs(app)
		if ca, err := app.ReadUpstreamProxyCAFile(); ca != "" || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted no CA after one dialog, got %q %v (%d dialogs)", ca, err, dialogs.shown)
		}
	})
}

func TestQuittingWithUnsavedWorkCanBeCancelledThenConfirmedOnce(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(1)
	dialog := withDialog(app, "Cancel")

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted cancelling to keep Marasi open")
	}
	dialog.answer = "Close Marasi"
	if prevent := app.beforeClose(); prevent {
		t.Fatal("wanted confirming to close Marasi")
	}
	// Closing the window and then quitting the app each run beforeClose.
	if prevent := app.beforeClose(); prevent {
		t.Fatal("wanted the confirmed quit to go ahead")
	}
	if len(dialog.asked) != 2 {
		t.Fatalf("wanted one dialog for the cancel and one for the confirm, got %d", len(dialog.asked))
	}
}

// recordQuits stands in for the Wails application's Quit: it asks
// shouldQuit, and reports each quit that went ahead on the returned channel.
func recordQuits(app *App) <-chan struct{} {
	quit := make(chan struct{}, 4)
	app.quitApp = func() {
		if app.shouldQuit() {
			quit <- struct{}{}
		}
	}
	return quit
}

func waitForQuit(t *testing.T, quit <-chan struct{}) {
	t.Helper()
	select {
	case <-quit:
	case <-time.After(5 * time.Second):
		t.Fatal("wanted Marasi to quit")
	}
}

func TestQuittingWithUnsavedWorkAsksBeforeQuitting(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(1)
	answers := make(chan string)
	app.messageDialog = func(messageDialogOptions) (string, error) { return <-answers, nil }
	quit := recordQuits(app)

	// Wails asks on the main thread, which must not wait for a dialog: the
	// quit is refused, and the question asked in the background. A second
	// ⌘Q while it is open doesn't ask again.
	if app.shouldQuit() || app.shouldQuit() {
		t.Fatal("wanted the quit held until the researcher answers")
	}
	answers <- "Cancel"
	waitUntilAnswered(t, app)
	select {
	case answers <- "Cancel":
		t.Fatal("wanted one dialog for both quits")
	case <-quit:
		t.Fatal("wanted cancelling to keep Marasi open")
	case <-time.After(50 * time.Millisecond):
	}

	app.shouldQuit()
	answers <- "Close Marasi"
	waitForQuit(t, quit)
	// answers has no reader now, so asking again would hang the quit.
	if !app.shouldQuit() {
		t.Fatal("wanted the confirmed quit to go ahead without asking again")
	}
}

// waitUntilAnswered waits until the app is no longer asking to quit.
func waitUntilAnswered(t *testing.T, app *App) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for app.askingToQuit.Load() {
		if time.Now().After(deadline) {
			t.Fatal("wanted the quit prompt answered")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestClosingTheWindowWithUnsavedWorkAsks(t *testing.T) {
	app := newTestApp(t)
	app.SetUnsavedDraftCount(1)
	dialog := withDialog(app, "Cancel")
	quit := recordQuits(app)
	cancelled := 0
	cancel := func() { cancelled++ }

	app.windowClosing(cancel)
	if cancelled != 1 || len(quit) != 0 || len(dialog.asked) != 1 {
		t.Fatalf("wanted the close cancelled after one dialog, got %d cancels, %d quits, %d dialogs", cancelled, len(quit), len(dialog.asked))
	}

	dialog.answer = "Close Marasi"
	app.windowClosing(cancel)
	if len(quit) != 1 || len(dialog.asked) != 2 {
		t.Fatalf("wanted confirming to quit Marasi, got %d quits after %d dialogs", len(quit), len(dialog.asked))
	}
	// Quitting closes the window again, which goes ahead without asking.
	cancelled = 0
	app.windowClosing(cancel)
	if cancelled != 0 || len(dialog.asked) != 2 {
		t.Fatalf("wanted the quit's close to go ahead, got %d cancels and %d dialogs", cancelled, len(dialog.asked))
	}
}

func TestClosingTheWindowQuitsMarasi(t *testing.T) {
	app := newTestApp(t)
	dialog := withDialog(app, "Cancel")
	quit := recordQuits(app)
	cancelled := false

	app.windowClosing(func() { cancelled = true })

	// The close itself is cancelled: the quit closes the window, so every OS
	// shuts down the same way.
	if !cancelled || len(quit) != 1 || len(dialog.asked) != 0 {
		t.Fatalf("wanted the close to become a quit without asking, got cancelled %v, %d quits, %d dialogs", cancelled, len(quit), len(dialog.asked))
	}
}

func TestCancelledFileDialogsReadAsNoPath(t *testing.T) {
	for name, answer := range map[string]struct {
		path string
		err  error
	}{
		"macOS and Linux": {"", nil},
		"Windows":         {"", errors.New("cancelled by user")},
	} {
		t.Run(name, func(t *testing.T) {
			if path, err := fileDialogResult(answer.path, answer.err); path != "" || err != nil {
				t.Fatalf("wanted a cancel, got %q %v", path, err)
			}
		})
	}
	failure := errors.New("dialog failed")
	if _, err := fileDialogResult("", failure); err != failure {
		t.Fatalf("wanted a real failure kept, got %v", err)
	}
	if path, err := fileDialogResult("/tmp/report.md", nil); path != "/tmp/report.md" || err != nil {
		t.Fatalf("wanted the chosen path, got %q %v", path, err)
	}
}

func TestRestartToUpdateRelaunches(t *testing.T) {
	app, _ := newInstalledApp(t)
	recordRestarts(app)
	relaunched := false
	app.relaunch = func(string) error {
		relaunched = true
		return nil
	}

	if restarted, err := app.RestartToUpdate(); !restarted || err != nil {
		t.Fatalf("wanted Marasi to restart, got %v %v", restarted, err)
	}
	if !relaunched {
		t.Fatal("wanted the installed build relaunched")
	}
}
