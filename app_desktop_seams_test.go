package main

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/wailsapp/wails/v3/pkg/application"
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

func TestStartupSendsMarasiEventsThroughEmitEvent(t *testing.T) {
	app := newProjectApp(t)
	releases := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(releases.Close)
	app.releaseSource = releases.URL
	t.Cleanup(app.stopUpdateChecks)
	events := &recordedEvents{}
	app.emitEvent = events.emit

	app.ServiceStartup(context.Background(), application.ServiceOptions{})
	app.Proxy.OnRequest(domain.ProxyRequest{ID: uuid.New()})
	app.Proxy.OnResponse(domain.ProxyResponse{ID: uuid.New()})
	app.Proxy.OnLog(domain.Log{Message: "Marasi log", Timestamp: time.Now()})
	app.Proxy.Logger.Info("App log")

	for _, name := range []string{"request", "response"} {
		if !events.has(name) {
			t.Fatalf("wanted a %s event, got %v", name, events.names)
		}
	}
	var marasiLog, appLog bool
	for i, name := range events.names {
		if name != "log" || len(events.data[i]) != 1 {
			continue
		}
		switch entry := events.data[i][0].(type) {
		case domain.Log:
			marasiLog = marasiLog || entry.Message == "Marasi log"
		case Log:
			appLog = appLog || entry.Message == "App log"
		}
	}
	if !marasiLog || !appLog {
		t.Fatalf("wanted log events for Marasi's log and the app's logger, got marasi=%v app=%v", marasiLog, appLog)
	}
}

func TestCancellingAFileDialogDoesNothing(t *testing.T) {
	t.Run("choosing a project", func(t *testing.T) {
		app := newProjectApp(t)
		dialogs := withCancelledFileDialogs(app)
		if path, err := app.OpenFileDialog(); path != "" || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted no path after one dialog, got %q %v (%d dialogs)", path, err, dialogs.shown)
		}
	})

	t.Run("saving the CA certificate", func(t *testing.T) {
		app := newCAApp(t)
		dialogs := withCancelledFileDialogs(app)
		if saved, err := app.DownloadCert(); saved || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted nothing saved after one dialog, got %v %v (%d dialogs)", saved, err, dialogs.shown)
		}
	})

	t.Run("saving an artifact", func(t *testing.T) {
		app := newLogbookApp(t)
		findings, err := app.Proxy.ReportingRepo.ListFindings()
		if err != nil || len(findings) == 0 {
			t.Fatalf("listing findings: %v", err)
		}
		artifact := &domain.Artifact{
			ArtifactMetadata: &domain.ArtifactMetadata{ID: uuid.New(), Filename: "proof.txt", MimeType: "text/plain", Size: 5, CreatedAt: time.Now()},
			FindingID:        &findings[0].ID,
			Data:             []byte("proof"),
		}
		if err := app.Proxy.ReportingRepo.SaveArtifact(artifact); err != nil {
			t.Fatalf("saving artifact: %v", err)
		}
		dialogs := withCancelledFileDialogs(app)
		if saved, err := app.DownloadArtifact(artifact.ID); saved || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted nothing saved after one dialog, got %v %v (%d dialogs)", saved, err, dialogs.shown)
		}
	})

	t.Run("exporting a report", func(t *testing.T) {
		app := newLogbookApp(t)
		templates, err := app.ListTemplates()
		if err != nil || len(templates) == 0 {
			t.Fatalf("wanted a report template, got %v %v", templates, err)
		}
		dialogs := withCancelledFileDialogs(app)
		if saved, err := app.ExportReport(templates[0], reportMetadata(map[string]any{})); saved || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted nothing saved after one dialog, got %v %v (%d dialogs)", saved, err, dialogs.shown)
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
		app := newProjectApp(t)
		dialogs := withCancelledFileDialogs(app)
		if ca, err := app.ReadUpstreamProxyCAFile(); ca != "" || err != nil || dialogs.shown != 1 {
			t.Fatalf("wanted no CA after one dialog, got %q %v (%d dialogs)", ca, err, dialogs.shown)
		}
	})
}

func TestExportingAReportWritesItWhereChosen(t *testing.T) {
	app := newLogbookApp(t)
	templates, err := app.ListTemplates()
	if err != nil || len(templates) == 0 {
		t.Fatalf("wanted a report template, got %v %v", templates, err)
	}
	path := filepath.Join(t.TempDir(), "report.md")
	app.saveFileDialog = func(saveDialogOptions) (string, error) { return path, nil }

	if saved, err := app.ExportReport(templates[0], reportMetadata(map[string]any{})); !saved || err != nil {
		t.Fatalf("wanted the report saved, got %v %v", saved, err)
	}
	written, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(written), "Report finding") {
		t.Fatalf("wanted the report with its finding in %s, got %q (%v)", path, written, err)
	}
}

func TestSavingTheCACertificateWritesThePEMWhereChosen(t *testing.T) {
	app := newCAApp(t)
	path := filepath.Join(t.TempDir(), "marasi-proxy.crt")
	var asked saveDialogOptions
	app.saveFileDialog = func(options saveDialogOptions) (string, error) {
		asked = options
		return path, nil
	}

	if saved, err := app.DownloadCert(); !saved || err != nil {
		t.Fatalf("wanted the certificate saved, got %v %v", saved, err)
	}
	if asked.DefaultFilename != "marasi-proxy.crt" {
		t.Fatalf("wanted marasi-proxy.crt suggested, got %+v", asked)
	}
	written, err := os.ReadFile(path)
	if err != nil || string(written) != caPEM(app) {
		t.Fatalf("wanted the CA PEM in %s, got %q (%v)", path, written, err)
	}
}

func TestCopyingTheCACertificatePutsThePEMOnTheClipboard(t *testing.T) {
	app := newCAApp(t)
	var copied []string
	app.setClipboardText = func(text string) error {
		copied = append(copied, text)
		return nil
	}

	if ok, err := app.CopyCertToClipboard(); !ok || err != nil {
		t.Fatalf("wanted the certificate copied, got %v %v", ok, err)
	}
	if len(copied) != 1 || copied[0] != caPEM(app) {
		t.Fatalf("wanted the CA PEM copied once, got %q", copied)
	}
}

// newCAApp returns an App whose proxy has its CA certificate, as starting
// the proxy loads it.
func newCAApp(t *testing.T) *App {
	t.Helper()
	app := newScratchpadApp(t)
	if err := app.Proxy.WithOptions(marasi.WithTLS()); err != nil {
		t.Fatalf("loading the CA: %v", err)
	}
	if app.Proxy.Cert == nil {
		t.Fatal("wanted the CA certificate loaded")
	}
	return app
}

// caPEM is the proxy's CA certificate as a PEM block, written out
// independently of the app's own encoding.
func caPEM(app *App) string {
	return "-----BEGIN CERTIFICATE-----\n" + wrap64(app.Proxy.Cert.Raw) + "-----END CERTIFICATE-----\n"
}

func wrap64(der []byte) string {
	encoded := base64.StdEncoding.EncodeToString(der)
	var out string
	for len(encoded) > 64 {
		out += encoded[:64] + "\n"
		encoded = encoded[64:]
	}
	return out + encoded + "\n"
}

func TestQuittingWithUnsavedWorkCanBeCancelledThenConfirmedOnce(t *testing.T) {
	app := newScratchpadApp(t)
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
	app := newScratchpadApp(t)
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
	app := newScratchpadApp(t)
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
	app := newScratchpadApp(t)
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

func TestRestartToUpdateRelaunchesOnlyAfterTheProjectIsReleased(t *testing.T) {
	app, _ := newInstalledApp(t)
	if err := app.setupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	path := scratchpadPath(t, app)
	recordRestarts(app)
	relaunched := false
	app.relaunch = func(string) error {
		assertProjectReleased(t, path)
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

func TestDecodingExtensionEvents(t *testing.T) {
	id := uuid.New()

	t.Run("a function call carries its state", func(t *testing.T) {
		call, ok := decodeExtensionFunctionCall(map[string]any{
			"extensionID": id.String(),
			"function":    "onClick",
			"state":       map[string]any{"count": 1.0},
		})
		if !ok || call.extensionID != id || call.function != "onClick" || len(call.args) != 1 {
			t.Fatalf("wanted onClick on %s with the state, got %+v %v", id, call, ok)
		}
		if state, _ := call.args[0].(map[string]any); state["count"] != 1.0 {
			t.Fatalf("wanted the state passed, got %+v", call.args)
		}
	})

	t.Run("a sync calls sync with its args", func(t *testing.T) {
		call, ok := decodeExtensionSync(map[string]any{
			"extensionID": id.String(),
			"args":        []any{"a", 2.0},
		})
		if !ok || call.extensionID != id || call.function != "sync" || len(call.args) != 2 || call.args[0] != "a" {
			t.Fatalf("wanted sync on %s with two args, got %+v %v", id, call, ok)
		}
	})

	t.Run("a sync without args calls sync with none", func(t *testing.T) {
		call, ok := decodeExtensionSync(map[string]any{"extensionID": id.String()})
		if !ok || call.function != "sync" || len(call.args) != 0 {
			t.Fatalf("wanted sync with no args, got %+v %v", call, ok)
		}
	})

	for name, payload := range map[string]any{
		"no payload":    nil,
		"not an object": "x",
		"a bad ID":      map[string]any{"extensionID": "nope", "function": "f", "state": map[string]any{}},
		"no function":   map[string]any{"extensionID": id.String(), "state": map[string]any{}},
		"no state":      map[string]any{"extensionID": id.String(), "function": "f"},
	} {
		t.Run("a call with "+name+" is ignored", func(t *testing.T) {
			if call, ok := decodeExtensionFunctionCall(payload); ok {
				t.Fatalf("wanted the call ignored, got %+v", call)
			}
		})
	}
	for name, payload := range map[string]any{
		"no payload": nil,
		"a bad ID":   map[string]any{"extensionID": 3},
	} {
		t.Run("a sync with "+name+" is ignored", func(t *testing.T) {
			if call, ok := decodeExtensionSync(payload); ok {
				t.Fatalf("wanted the sync ignored, got %+v", call)
			}
		})
	}
}

func TestLoadExtensionsListensForExtensionEvents(t *testing.T) {
	app := newScratchpadApp(t)
	listening := map[string]func(any){}
	app.onEvent = func(name string, handle func(payload any)) {
		listening[name] = handle
	}

	if err := app.LoadExtensions(); err != nil {
		t.Fatalf("loading extensions: %v", err)
	}
	for _, name := range []string{"extension_call_function", "extension_sync_state"} {
		if listening[name] == nil {
			t.Fatalf("wanted a listener for %s, got %v", name, listening)
		}
		listening[name](nil) // a malformed payload is ignored
	}
}
