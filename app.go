package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"aead.dev/minisign"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App struct
type App struct {
	// wails is the Wails application the desktop functions call
	// (desktop.go). main sets it; tests leave it nil.
	wails *application.App
	// ctx is the context Wails starts the app with, cancelled at shutdown.
	ctx       context.Context
	emitEvent emitFunc
	// launchChrome starts Chrome with the paths and profiles in Marasi's
	// config (chrome.go). Tests replace it. marasiConfigDir is Marasi's config
	// directory: marasi_config.yaml with those paths and profiles
	// (chrome_config.go), and the profiles' user-data directories.
	launchChrome    func(ChromeLaunch) error
	marasiConfigDir string
	Config          *Config
	// messageDialog shows a native message dialog and returns the pressed
	// button. Tests replace it.
	messageDialog func(messageDialogOptions) (string, error)
	// openFileDialog and saveFileDialog show a native file dialog and
	// return the chosen path, "" when the user cancelled. Tests replace them.
	openFileDialog func(openDialogOptions) (string, error)
	saveFileDialog func(saveDialogOptions) (string, error)
	// shareFile, set on iOS only, replaces the save dialog and the write
	// after it: it shows the share sheet for a file of these bytes and
	// returns its name, "" when cancelled (share_file_ios.go).
	shareFile func(name string, data []byte) (string, error)
	// setClipboardText puts text on the system clipboard. Tests replace it.
	setClipboardText func(text string) error
	// The local instance (local_instance.go). runCLI runs the Marasi CLI,
	// findCLI finds it, and newPassword generates a control password; tests
	// replace all three. cliConfigDir is the --config-dir every CLI call
	// passes, from MARASI_APP_CLI_CONFIG_DIR; "" uses the CLI's default.
	runCLI      runCLIFunc
	findCLI     func() (string, error)
	newPassword func() (string, error)
	// keychain keeps connection passwords on a release build; nil on a
	// development build, which uses a 0600 file instead (keychain.go).
	keychain     *keychain
	cliConfigDir string
	// localProxyListener reads the local instance's proxy listener, "" when
	// none runs; update requests skip a system proxy that is it
	// (update_client.go). Tests replace it.
	localProxyListener func() string
	// locals is each local connection's instance, by connection id
	// (local_instance.go's localFor).
	localsMu sync.Mutex
	locals   map[string]*localInstance
	// cliRuntime holds the Marasi CLI's replaceable functions (cli.go).
	cliRuntime cliRuntime
	// unsavedDrafts is the number of launchpads with a dirty Launchpad
	// draft, reported by the frontend, which holds drafts in memory only.
	unsavedDrafts atomic.Int64
	// unsavedLogbookEdits is whether a Logbook edit session or inline fix
	// has unsaved input, reported by the frontend.
	unsavedLogbookEdits atomic.Bool
	// activeArmoryRuns is the number of Armory runs active on the service,
	// reported by the frontend (armory_guard.go). armoryCancelReply waits
	// for the frontend's answer to a cancel; armoryCancelTimeout bounds it
	// (0 is the default).
	activeArmoryRuns    atomic.Int64
	armoryCancelMu      sync.Mutex
	armoryCancelReply   chan string
	armoryCancelTimeout time.Duration

	// Updates (update.go). build is the running build, from the build-time
	// buildChannel and version; tests set their own.
	build BuildInfo
	// releaseSource is the base URL of the GitHub releases API releases are
	// read from (defaultReleaseSource); tests point it at a fake server.
	releaseSource string
	// updateClient replaces the client update requests use; nil uses
	// updateHTTPClient's.
	updateClient *http.Client
	// systemProxy finds the system proxy for an update request; nil reads
	// the environment and the OS proxy settings. Tests point it at a proxy.
	systemProxy func(*http.Request) (*url.URL, error)
	// updates is the known update state.
	updates updater
	// updateSchedule runs the automatic checks (update_schedule.go).
	updateSchedule updateScheduler
	// updateTicker replaces the ticker automatic checks follow; nil uses a
	// time.Ticker. Tests tick by hand.
	updateTicker func(interval time.Duration) (<-chan time.Time, func())
	// signingKey is the Marasi signing key updates must be signed with
	// (docs/adr/2026-10-17-updates-are-signed-with-an-embedded-key.md), from the key built into the app; nil when the build has none,
	// and then it cannot install updates.
	signingKey *minisign.PublicKey
	// installer is the platform's part of installing an update
	// (update_platform_<goos>.go); nil where the app cannot replace itself.
	installer platformInstaller
	// installLocation is the file or bundle an install replaces, resolved
	// from the running executable; "" when it could not be found.
	installLocation string
	// relaunch starts the build at installLocation while the app shuts down
	// after "Restart now". Tests record the call.
	relaunch func(location string) error
	// quitApp quits through the normal shutdown, shouldQuit included.
	quitApp func()
	// quitting is set once beforeClose lets Marasi close, so a quit that
	// passes through it twice (closing the window, then quitting the app)
	// asks only once.
	quitting atomic.Bool
	// askingToQuit is set while askThenQuit waits for an answer, so a second
	// ⌘Q or close doesn't open a second prompt.
	askingToQuit atomic.Bool
	// quitQuestion waits for, and keeps, the answer to "Stop Marasi too?"
	// (quit_question.go).
	quitQuestion quitQuestion
	// restarting is set once the researcher confirmed "Restart now", so
	// beforeClose does not ask about losing work a second time and close
	// relaunches.
	restarting atomic.Bool
}

// NewApp creates the App on the app config in this machine's user config
// directory.
func NewApp() *App {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatal(fmt.Errorf("reading user config dir : %w", err))
	}
	appConfigDir := filepath.Join(userConfigDir, "Marasi")
	config, err := LoadConfig(appConfigDir)
	if err != nil {
		log.Fatal(err)
	}
	app := newApp(appConfigDir)
	app.Config = config
	return app
}

// newApp wires the desktop runtime around configDir, the app config
// directory. Everything about projects and traffic is the service's: the
// frontend reaches it through its service client.
func newApp(configDir string) *App {
	app := &App{
		build:         BuildInfo{Channel: buildChannel, Version: version},
		releaseSource: defaultReleaseSource,
	}
	app.useDesktopRuntime()
	app.useLocalInstanceRuntime()
	app.useKeychainRuntime()
	app.signingKey = loadSigningKey()
	app.installer = defaultInstaller()
	app.installLocation = resolveInstallLocation(app.installer)
	app.relaunch = func(location string) error {
		if app.installer == nil {
			return errors.New("Marasi cannot relaunch itself on this platform")
		}
		return app.installer.relaunch(location)
	}
	app.launchChrome = launchWithMarasi
	// Marasi's config directory is the local instance's: the CLI's override,
	// else the app config directory, which is Marasi's default.
	app.marasiConfigDir = configDir
	if app.cliConfigDir != "" {
		app.marasiConfigDir = app.cliConfigDir
	}
	return app
}

// ServiceStartup is called when Wails starts the app, before the window
// loads. It saves the app's context and starts the update checks; the
// frontend connects to the service.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	go a.removeUpdateLeftovers()
	go a.removeCLILeftovers()
	a.startUpdateChecks(ctx)
	return nil
}

func (a *App) ToggleFlag(name string) (*Config, error) {
	err := a.Config.ToggleFlag(name)
	if err != nil {
		return a.Config, fmt.Errorf("toggling flag : %w", err)
	}
	return a.Config, nil
}

func (a *App) SetFlag(name string, value string) (*Config, error) {
	err := a.Config.SetFlag(name, value)
	if err != nil {
		return a.Config, fmt.Errorf("setting flag : %w", err)
	}
	return a.Config, nil
}

// OpenFileDialog shows a file selection dialog and returns the selected file path
func (a *App) OpenFileDialog() (string, error) {
	// Create simple file filters for project files
	filters := []fileFilter{
		{
			DisplayName: "Project Files (*.marasi)",
			Pattern:     "*.marasi",
		},
		{
			DisplayName: "All Files (*.*)",
			Pattern:     "*.*",
		},
	}

	// Create the dialog options
	dialogOptions := openDialogOptions{
		Title:   "Select Project File",
		Filters: filters,
	}

	// Show the dialog and return the selected path
	return a.openFileDialog(dialogOptions)
}

// ConfirmProjectSwitch asks before a project switch discards unsaved
// Launchpad drafts or cancels active Armory runs, and reports whether the
// switch goes ahead. The frontend opens the project on the service once it
// does.
func (a *App) ConfirmProjectSwitch() (bool, error) {
	return a.confirmLosingWork("Switch Project")
}

// ServiceShutdown is called when Wails shuts the app down, after the quit
// went ahead. When the quit question or When quitting said Stop, it stops
// every owned run (a local instance's run the app started, in this launch
// or an earlier one); after "Restart now" it stops none, and relaunches.
func (a *App) ServiceShutdown() error {
	a.stopUpdateChecks()
	a.CancelUpdateDownload()
	if a.stopsOwnedRunsOnQuit() {
		if err := a.stopOwnedRuns(); err != nil {
			log.Printf("%v", err)
		}
	}
	a.relaunchIfRestarting()
	return nil
}

// shouldQuit is Wails' ShouldQuit: it reports whether a quit may go ahead.
// It runs on the main thread, where waiting for a dialog would hang Linux, so
// when the quit would lose work or ask the quit question and isn't
// confirmed yet it refuses, and asks in the background before quitting
// again.
func (a *App) shouldQuit() bool {
	if a.restarting.Load() || a.quitting.Load() {
		return true
	}
	if !a.hasWorkToLose() && !a.asksOnQuit() {
		a.quitting.Store(true)
		return true
	}
	if a.askingToQuit.CompareAndSwap(false, true) {
		go a.askThenQuit()
	}
	return false
}

// windowClosing runs when the researcher closes the window. Closing it quits
// Marasi, so the close is cancelled and Marasi asks and quits instead: one
// shutdown path on every OS. The quit's own closing of the window goes ahead.
func (a *App) windowClosing(cancel func()) {
	if a.restarting.Load() || a.quitting.Load() {
		return
	}
	cancel()
	if a.askingToQuit.CompareAndSwap(false, true) {
		a.askThenQuit()
	}
}

// askThenQuit quits unless beforeClose keeps Marasi open. The caller has set
// askingToQuit, so only one prompt is open at a time.
func (a *App) askThenQuit() {
	defer a.askingToQuit.Store(false)
	if a.beforeClose() {
		return
	}
	a.quitApp()
}

// beforeClose asks before closing Marasi would lose work, then asks the quit
// question, and reports whether to keep Marasi open.
func (a *App) beforeClose() bool {
	// "Restart now" or an earlier pass has already warned about losing work.
	if a.restarting.Load() || a.quitting.Load() {
		return false
	}
	confirmed, err := a.confirmLosingWork("Close Marasi")
	if err != nil {
		log.Printf("cancelling active Armory runs: %v", err)
	}
	if err != nil || !confirmed {
		return true
	}
	if a.askAboutOwnedRuns() {
		return true
	}
	a.quitting.Store(true)
	return false
}

// SetUnsavedDraftCount records how many launchpads have a dirty Launchpad
// draft. The frontend calls it whenever that number changes, so quitting or
// switching the project can warn before the drafts are lost.
func (a *App) SetUnsavedDraftCount(count int) {
	a.unsavedDrafts.Store(int64(count))
}

// SetUnsavedLogbookEdits records whether the Logbook has unsaved edits (an
// open finding or test case, or an inline fix with input). The frontend
// calls it whenever that changes, so quitting, switching the project or
// following another client's switch can warn first.
func (a *App) SetUnsavedLogbookEdits(unsaved bool) {
	a.unsavedLogbookEdits.Store(unsaved)
}

// confirmLosingWork asks once before action discards unsaved Launchpad
// drafts or Logbook edits or cancels active Armory runs, naming whichever
// applies. It returns
// true when there is nothing to lose, or the user goes ahead and any active
// Armory runs were cancelled.
func (a *App) confirmLosingWork(action string) (bool, error) {
	return a.askLosingWork(lossPrompt{action: action, cancel: "Cancel", end: " Continue?"})
}

// ConfirmFollowProject asks before loading project, which another client
// (the Marasi CLI, another app) opened on the service, discards unsaved
// Launchpad drafts or Logbook edits or cancels active Armory runs. Stay keeps the pages on the project they show. It returns true when
// there is nothing to lose or the user chose to load it.
func (a *App) ConfirmFollowProject(project string) (bool, error) {
	action := "Load " + project
	return a.askLosingWork(lossPrompt{
		lead:   "Another client opened " + project + ".",
		action: action,
		cancel: "Stay",
	})
}

// lossPrompt is what askLosingWork asks: lead opens the message, action is
// the title and the button that goes ahead, cancel the one that doesn't, and
// end closes the message.
type lossPrompt struct {
	lead, action, cancel, end string
}

func (a *App) askLosingWork(prompt lossPrompt) (bool, error) {
	var losses []string
	if prompt.lead != "" {
		losses = append(losses, prompt.lead)
	}
	lead := len(losses)
	if drafts := a.draftsMessage(); drafts != "" {
		losses = append(losses, drafts+" "+prompt.action+" will discard them.")
	}
	if a.unsavedLogbookEdits.Load() {
		losses = append(losses, "The Logbook has unsaved edits. "+prompt.action+" will discard them.")
	}
	hasRuns := a.hasActiveArmoryRuns()
	if hasRuns {
		losses = append(losses, prompt.action+" will cancel all active Armory runs.")
	}
	if len(losses) == lead {
		return true, nil
	}
	if !a.confirmWith(prompt.action, strings.Join(losses, " ")+prompt.end, prompt.cancel) {
		return false, nil
	}
	if !hasRuns {
		return true, nil
	}
	return a.cancelArmoryRuns()
}

// hasWorkToLose reports whether closing Marasi now would discard unsaved
// Launchpad drafts or Logbook edits, or cancel active Armory runs.
func (a *App) hasWorkToLose() bool {
	return a.unsavedDrafts.Load() > 0 || a.unsavedLogbookEdits.Load() || a.hasActiveArmoryRuns()
}

// draftsMessage describes the unsaved Launchpad drafts, or is empty.
func (a *App) draftsMessage() string {
	count := a.unsavedDrafts.Load()
	switch {
	case count <= 0:
		return ""
	case count == 1:
		return "1 launchpad has an unsaved draft."
	default:
		return fmt.Sprintf("%d launchpads have unsaved drafts.", count)
	}
}

// confirm shows a warning dialog with Cancel and action buttons and reports
// whether the user pressed action.
func (a *App) confirm(action, message string) bool {
	return a.confirmWith(action, message, "Cancel")
}

// confirmWith is confirm with cancel naming the button that doesn't go ahead.
func (a *App) confirmWith(action, message, cancel string) bool {
	result, err := a.messageDialog(messageDialogOptions{
		Type:          warningDialog,
		Title:         action,
		Message:       message,
		Buttons:       []string{cancel, action},
		DefaultButton: cancel,
		CancelButton:  cancel,
	})
	if err != nil {
		log.Printf("confirming %s: %v", action, err)
		return false
	}
	return result == action
}

func (a *App) GetMarasiConfig() *Config {
	return a.Config
}

// CopyCertToClipboard puts the proxy certificate's PEM, which the frontend
// read from the service's GET /certificate, on the clipboard.
func (a *App) CopyCertToClipboard(certPEM string) (bool, error) {
	if certPEM == "" {
		return false, fmt.Errorf("certificate is not available")
	}
	if err := a.setClipboardText(certPEM); err != nil {
		return false, err
	}
	return true, nil
}
