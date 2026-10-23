package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/user"
	"path"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"aead.dev/minisign"
	"github.com/tfkr-ae/marasi/chrome"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/extensions"
	"github.com/tfkr-ae/marasi/wordlist"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/service"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx       context.Context
	emitEvent emitFunc
	Proxy     *marasi.Proxy
	listener  service.ListenerLifecycle
	projects  *service.ProjectLifecycle
	chrome    *service.Chrome
	Config    *Config
	// checkpointTimes records when each held Checkpoint item was
	// intercepted (checkpoint.go).
	checkpointTimes checkpointTimes
	// attachFrontendLog sends the project lifecycle's log to the frontend
	// once startup has the Wails context. Nil in tests.
	attachFrontendLog func(slog.Handler)
	// messageDialog shows a native message dialog and returns the pressed
	// button. Tests replace it.
	messageDialog func(runtime.MessageDialogOptions) (string, error)
	// unsavedDrafts is the number of launchpads with a dirty Launchpad
	// draft, reported by the frontend, which holds drafts in memory only.
	unsavedDrafts atomic.Int64

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
	// quitApp quits through the normal shutdown, beforeClose included.
	quitApp func()
	// restarting is set once the researcher confirmed "Restart now", so
	// beforeClose does not ask about losing work a second time and close
	// relaunches.
	restarting atomic.Bool
}

// NewApp creates a new App application struct
func NewApp() *App {
	// get the default user config
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatal(fmt.Errorf("reading user config dir : %w", err))
	}
	// Check and make application config directory
	appConfigDir := filepath.Join(userConfigDir, "Marasi")
	config, err := LoadConfig(appConfigDir)
	if err != nil {
		log.Fatal(err)
	}

	wordlists, err := wordlist.NewManager(appConfigDir)
	if err != nil {
		log.Fatal(err)
	}

	Proxy, err := marasi.New(
		marasi.WithConfigDir(appConfigDir),
		marasi.WithWordlistManager(wordlists),
		marasi.WithBasePipeline(),
		marasi.WithDefaultModifierPipeline(),
	)
	if err != nil {
		log.Fatal(err)
	}
	logger, attachFrontendLog := newRelayLogger(Proxy.Logger.Handler())
	app := newApp(Proxy, appConfigDir, wordlists, log.Writer(), logger)
	app.attachFrontendLog = attachFrontendLog
	app.Config = config
	return app
}

// newApp wires the shared service lifecycles around proxy. The project is
// bound to the listener so listener shutdown interrupts project Lua before
// draining the requests it may be holding.
func newApp(proxy *marasi.Proxy, configDir string, wordlists wordlist.Provider, logWriter io.Writer, logger *slog.Logger) *App {
	app := &App{
		Proxy:         proxy,
		build:         BuildInfo{Channel: buildChannel, Version: version},
		releaseSource: defaultReleaseSource,
	}
	app.emitEvent = app.emit
	app.signingKey = loadSigningKey()
	app.installer = defaultInstaller()
	app.installLocation = resolveInstallLocation(app.installer)
	app.relaunch = func(location string) error {
		if app.installer == nil {
			return errors.New("Marasi cannot relaunch itself on this platform")
		}
		return app.installer.relaunch(location)
	}
	app.quitApp = func() { runtime.Quit(app.ctx) }
	app.messageDialog = nativeMessageDialog(goruntime.GOOS, func(options runtime.MessageDialogOptions) (string, error) {
		return runtime.MessageDialog(app.ctx, options)
	})
	listener := service.NewListenerLifecycle(proxy, logWriter)
	app.projects = service.NewProjectLifecycle(proxy, configDir, wordlists, logger, app.attachExtensionHooks)
	listener.BindProject(app.projects)
	app.listener = listener
	app.chrome = service.NewChrome(proxy, listener, logWriter)
	app.configureWebSocketHandlers()
	app.configureLaunchHandlers()
	app.configureCheckpointHandlers()
	return app
}

// startup is called when the app starts. It saves the context for the
// runtime methods, sends the project lifecycle's log to the frontend, and
// sets Marasi's request, response and log handlers. Those three call
// runtime.EventsEmit directly, so a test's emitEvent does not see them.
// It opens no project and starts no listener: the frontend does both.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.removeUpdateLeftovers()
	logHandler := NewLogHandler(ctx)
	if a.attachFrontendLog != nil {
		a.attachFrontendLog(logHandler.Handler())
	}
	a.Proxy.WithOptions(
		marasi.WithRequestHandler(func(req domain.ProxyRequest) error {
			runtime.EventsEmit(a.ctx, "request", req)
			return nil
		}),
		marasi.WithResponseHandler(func(res domain.ProxyResponse) error {
			runtime.EventsEmit(a.ctx, "response", res)
			return nil
		}),
		marasi.WithLogHandler(func(logItem domain.Log) error {
			runtime.EventsEmit(a.ctx, "log", logItem)
			return nil
		}),
		marasi.WithLogger(logHandler),
	)
	a.startUpdateChecks(ctx)
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
func (a *App) DeleteWaypoint(host string) error {
	_, err := a.Proxy.ApplyWaypointChange(func(repo domain.WaypointRepository) (bool, error) {
		return true, repo.DeleteWaypoint(host)
	})
	return err
}

func (a *App) GetInterceptFlag() bool {
	return a.Proxy.GetIntercept()
}

func (a *App) SetIntercept(enabled bool) bool {
	a.Proxy.SetIntercept(enabled)
	return a.Proxy.GetIntercept()
}

func (a *App) ToggleIntercept() bool {
	return a.SetIntercept(!a.Proxy.GetIntercept())
}
func (a *App) GetExtensionLogs(name string) ([]extensions.ExtensionLog, error) {
	if extension, ok := a.Proxy.GetExtension(name); ok {
		return extension.LogSnapshot(), nil
	}
	return []extensions.ExtensionLog{}, fmt.Errorf("extension %s not found", name)
}
func (a *App) CreateWaypoint(host string, override string) error {
	_, err := a.Proxy.ApplyWaypointChange(func(repo domain.WaypointRepository) (bool, error) {
		return true, repo.CreateOrUpdateWaypoint(host, override)
	})
	return err
}
func (a *App) GetWaypoints() (map[string]string, error) {
	err := a.Proxy.SyncWaypoints()
	if err != nil {
		return nil, err
	}
	return a.Proxy.Waypoints, nil
}

func listenerSettings(addr string, port string) (service.ListenerSettings, error) {
	if addr == "" || port == "" {
		return service.ListenerSettings{}, service.ErrListenerUnavailable
	}
	parsed, err := strconv.ParseUint(port, 10, 16)
	if err != nil {
		return service.ListenerSettings{}, service.ErrListenerUnavailable
	}
	portNumber := uint16(parsed)
	return service.ListenerSettings{Address: &addr, Port: &portNumber}, nil
}

func (a *App) StartProxy(addr string, port string) error {
	settings, err := listenerSettings(addr, port)
	if err != nil {
		return err
	}
	if err := a.Proxy.WithOptions(marasi.WithTLS()); err != nil {
		return err
	}
	_, err = a.listener.Start(context.Background(), settings)
	return err
}

func (a *App) StopProxy() error {
	_, err := a.listener.Stop(context.Background())
	return err
}

func (a *App) UpdateProxy(addr string, port string) error {
	settings, err := listenerSettings(addr, port)
	if err != nil {
		return err
	}
	_, err = a.listener.Update(context.Background(), settings)
	return err
}

// OpenFileDialog shows a file selection dialog and returns the selected file path
func (a *App) OpenFileDialog() (string, error) {
	// Create simple file filters for project files
	filters := []runtime.FileFilter{
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
	dialogOptions := runtime.OpenDialogOptions{
		Title:   "Select Project File",
		Filters: filters,
	}

	// Show the dialog and return the selected path
	return runtime.OpenFileDialog(a.ctx, dialogOptions)
}

// OpenProject switches to the project at name, a path or a bare name in the
// config directory, and returns its name. It asks first when unsaved work
// would be lost; a refusal is "project switch cancelled", which the frontend
// matches to close its opening screen quietly.
func (a *App) OpenProject(name string) (string, error) {
	var filePath string

	// Check if name already has directory information
	if filepath.IsAbs(name) || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		// Use the provided path directly
		filePath = name
	} else {
		// It's just a name, add the config directory
		filePath = filepath.Join(a.Proxy.ConfigDir, name)
	}

	// Ensure it has the .marasi extension
	if !strings.HasSuffix(filePath, ".marasi") {
		filePath = filePath + ".marasi"
	}

	if err := checkpointHeldError(a.Proxy.CheckpointItems()); err != nil {
		return "", err
	}
	confirmed, err := a.confirmLosingWork("Switch Project")
	if err != nil {
		return "", err
	}
	if !confirmed {
		return "", errors.New("project switch cancelled")
	}
	// From here the open is underway: the frontend's opening screen may show.
	a.emitEvent(projectOpeningEvent)
	// The project lifecycle interrupts pending launches before it switches
	// (marasi docs/adr/2026-10-13-launches-are-tracked-and-cancellable.md), so they end in the project they were launched in.
	if err := a.projects.Open(context.Background(), filePath); err != nil {
		return "", openProjectError(err)
	}
	// The drafts belonged to the old project and are gone with it.
	a.unsavedDrafts.Store(0)
	a.prepareOpenedProject()
	base := filepath.Base(filePath)
	projectName := strings.TrimSuffix(base, filepath.Ext(base))
	return projectName, nil
}

// A project another Marasi (an app or a service instance) owns reads as
// projectLocked: "opening project: project_locked: project already open: <path>".
// A failed open leaves the open project as it was.
const projectLocked = "project_locked"

// openProjectError gives a refused open its code for the frontend.
func openProjectError(err error) error {
	if errors.Is(err, service.ErrProjectAlreadyOpen) {
		return fmt.Errorf("opening project: %s: %w", projectLocked, err)
	}
	return err
}

// checkpointHeld refuses a switch while Checkpoint holds an item:
// "opening project: checkpoint_held (<id>, <id>): <cause>". Marasi would
// wait for the item, or drop it when a launch holds it
// (marasi docs/adr/2026-10-17-project-switch-waits-for-held-checkpoint-items.md),
// so the frontend asks to forward or drop the items first.
const checkpointHeld = "checkpoint_held"

var errCheckpointHeld = errors.New("forward or drop the held Checkpoint items before switching projects")

// checkpointHeldError refuses with checkpointHeld naming the held items, or
// is nil when none is held.
func checkpointHeldError(items []domain.CheckpointItem) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID.String()
	}
	return codedError("opening project", checkpointHeld, ids, errCheckpointHeld)
}

// projectOpeningEvent tells the frontend that OpenProject has got past the
// unsaved-work prompt and is opening the project.
const projectOpeningEvent = "project-opening"

// ScratchpadPath is the scratchpad's file path, which startup opens first.
func (a *App) ScratchpadPath() string {
	return path.Join(a.Proxy.ConfigDir, "scratchpad.marasi")
}

// SetupScratchpad opens the scratchpad like OpenProject, without the
// unsaved-work prompt or the project-opening event.
func (a *App) SetupScratchpad() error {
	if err := a.projects.Open(context.Background(), a.ScratchpadPath()); err != nil {
		return openProjectError(err)
	}
	a.prepareOpenedProject()
	return nil
}

// prepareOpenedProject brings a just-opened project up to date with the
// app. Failures are logged; the project stays usable.
func (a *App) prepareOpenedProject() {
	if err := recoverInterruptedArmoryRuns(a.Proxy.Armory.Repo()); err != nil {
		log.Printf("recovering interrupted armory runs: %v", err)
	}
	if err := a.migrateLegacyExclusion(); err != nil {
		log.Printf("migrating content-type exclusion: %v", err)
	}
}
func (a *App) close(ctx context.Context) {
	a.stopUpdateChecks()
	a.CancelUpdateDownload()
	// Like the service's shutdown: end pending launches first, so their
	// outcomes are written to the open project before the listener goes.
	a.Proxy.InterruptLaunches()
	_ = a.listener.Shutdown()
	if a.projects != nil {
		if err := a.projects.Shutdown(); err != nil {
			log.Printf("releasing open project: %v", err)
		}
	}
	a.relaunchIfRestarting()
}

func (a *App) beforeClose(ctx context.Context) bool {
	// "Restart now" has already warned about losing work.
	if a.restarting.Load() {
		return false
	}
	confirmed, err := a.confirmLosingWork("Close Marasi")
	if err != nil {
		log.Printf("cancelling active Armory runs: %v", err)
	}
	return err != nil || !confirmed
}

// SetUnsavedDraftCount records how many launchpads have a dirty Launchpad
// draft. The frontend calls it whenever that number changes, so quitting or
// switching the project can warn before the drafts are lost.
func (a *App) SetUnsavedDraftCount(count int) {
	a.unsavedDrafts.Store(int64(count))
}

// confirmLosingWork asks once before action discards unsaved Launchpad
// drafts or cancels active Armory runs, naming whichever applies. It returns
// true when there is nothing to lose, or the user goes ahead and any active
// Armory runs were cancelled.
func (a *App) confirmLosingWork(action string) (bool, error) {
	var losses []string
	if drafts := a.draftsMessage(); drafts != "" {
		losses = append(losses, drafts+" "+action+" will discard them.")
	}
	hasRuns := a.Proxy != nil && a.Proxy.Armory != nil && len(a.Proxy.Armory.ActiveRunIDs()) > 0
	if hasRuns {
		losses = append(losses, action+" will cancel all active Armory runs.")
	}
	if len(losses) == 0 {
		return true, nil
	}
	if !a.confirm(action, strings.Join(losses, " ")+" Continue?") {
		return false, nil
	}
	if !hasRuns {
		return true, nil
	}
	return a.cancelArmoryRuns()
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
	result, err := a.messageDialog(runtime.MessageDialogOptions{
		Type:          runtime.WarningDialog,
		Title:         action,
		Message:       message,
		Buttons:       []string{"Cancel", action},
		DefaultButton: "Cancel",
		CancelButton:  "Cancel",
	})
	if err != nil {
		log.Printf("confirming %s: %v", action, err)
		return false
	}
	return result == action
}

// cancelArmoryRuns cancels every active Armory run and waits for them to stop.
func (a *App) cancelArmoryRuns() (bool, error) {
	activeRunIDs := a.Proxy.Armory.ActiveRunIDs()
	for _, id := range activeRunIDs {
		if err := a.Proxy.Armory.CancelRun(id); err != nil {
			for _, activeID := range a.Proxy.Armory.ActiveRunIDs() {
				if activeID == id {
					return false, fmt.Errorf("cancelling armory run %s: %w", id, err)
				}
			}
		}
	}

	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for len(a.Proxy.Armory.ActiveRunIDs()) > 0 {
		select {
		case <-ticker.C:
		case <-timer.C:
			return false, errors.New("timed out cancelling active Armory runs")
		}
	}
	return true, nil
}

func recoverInterruptedArmoryRuns(repo domain.ArmoryRepository) error {
	templates, err := repo.GetArmoryTemplates()
	if err != nil {
		return fmt.Errorf("getting armory templates: %w", err)
	}
	for _, template := range templates {
		runs, err := repo.GetArmoryRuns(template.ID)
		if err != nil {
			return fmt.Errorf("getting armory runs: %w", err)
		}
		for _, run := range runs {
			if run.Status != domain.ArmoryRunInProgress {
				continue
			}
			finishedAt := time.Now()
			run.Status = domain.ArmoryRunCancelled
			run.FinishedAt = &finishedAt
			if err := repo.UpdateArmoryRun(run); err != nil {
				return fmt.Errorf("recovering interrupted armory run %s: %w", run.ID, err)
			}
		}
	}
	return nil
}

func (a *App) GetLogs() ([]*domain.Log, error) {
	logs, err := a.Proxy.LogRepo.GetLogs()
	if err != nil {
		return nil, fmt.Errorf("getting logs : %w", err)
	}
	return logs, nil
}
func (a *App) GetRawDetails(id uuid.UUID) *domain.RequestResponseRow {
	row, err := a.Proxy.TrafficRepo.GetRequestResponseRow(id)
	if err != nil {
		log.Print(err)
	}
	return row
}

type ExtensionUI struct {
	UICode  string
	Version string
}

type Dashboard struct {
	Requests      int
	Notes         int
	Launchpads    int
	Interceptions int
	// InterceptionsComplete is false while Marasi's intercepted_count job is
	// still counting the pairs captured before the project kept the count,
	// so Interceptions can be low; the dashboard shows it as counting.
	InterceptionsComplete bool
}

// CountNotes reads the dashboard's four counts in one read.
func (a *App) CountNotes() (Dashboard, error) {
	counts, err := a.Proxy.StatsRepo.DashboardCounts()
	if err != nil {
		return Dashboard{}, fmt.Errorf("counting the dashboard : %w", err)
	}
	complete, known := counts.Complete[domain.JobInterceptedCount]
	return Dashboard{
		Requests:              counts.Pairs,
		Notes:                 counts.Notes,
		Launchpads:            counts.Launchpads,
		Interceptions:         counts.Intercepted,
		InterceptionsComplete: complete || !known,
	}, nil
}
func (a *App) StartBrowser(profile string) error {
	// The app opens a window for the user, so it asks for no CDP endpoint.
	_, err := a.chrome.Start(context.Background(), profile, service.ChromeStartOptions{})
	if err != nil {
		return fmt.Errorf("starting chrome : %w", err)
	}
	return nil
}
func (a *App) GetExtensionUI(extensionName string) (extUI ExtensionUI) {
	if extension, ok := a.Proxy.GetExtension(extensionName); ok {
		ui, err := extension.GetGlobalString("ui_code")
		if err != nil {
			log.Print(err)
			return extUI
		}
		version, err := extension.GetGlobalString("version")
		if err != nil {
			log.Print(err)
			return extUI
		}
		extUI.UICode = ui
		extUI.Version = version
		return extUI
	}
	return extUI
}
func (a *App) GetExtensionFlag(extensionName string, flagName string) (bool, error) {
	if extension, ok := a.Proxy.GetExtension(extensionName); ok {
		return extension.CheckGlobalFlag(flagName), nil
	}
	return false, fmt.Errorf("checking if %s exists", extensionName)
}
func (a *App) GetResponse(id uuid.UUID) *domain.ProxyResponse {
	response, err := a.Proxy.TrafficRepo.GetResponse(id)
	if err != nil {
		return nil
	}
	return response
}

func (a *App) GetCheckpoint(id uuid.UUID) *domain.CheckpointItem {
	item, ok := a.Proxy.GetCheckpoint(id)
	if !ok {
		return nil
	}
	return &item
}

func (a *App) ForwardCheckpoint(id uuid.UUID, body string, interceptResponse bool) error {
	fwd := marasi.CheckpointForward{InterceptResponse: interceptResponse}
	if body != "" {
		item, ok := a.Proxy.GetCheckpoint(id)
		if !ok {
			return checkpointGoneError(id, fmt.Errorf("%w: %s", marasi.ErrCheckpointNotFound, id))
		}
		raw := []byte(body)
		if item.Type == domain.CheckpointTypeWebSocket {
			fwd.Payload = &raw
		} else {
			fwd.Raw = &raw
		}
	}
	return a.settleCheckpoint(id, func() error { return a.Proxy.ForwardCheckpoint(id, fwd) })
}

func (a *App) DropCheckpoint(id uuid.UUID) error {
	return a.settleCheckpoint(id, func() error { return a.Proxy.DropCheckpoint(id) })
}

// Launch sends raw from the launchpad and returns the launch id, which is
// also the UUID of the entry it creates. A malformed request or a missing
// Host fails at once; how the launch ends arrives as a launch-finished event.
func (a *App) Launch(raw string, launchpadID string, useHttps bool) (uuid.UUID, error) {
	id, err := a.Proxy.Launch(raw, launchpadID, useHttps)
	if err != nil {
		log.Println(err)
		return uuid.Nil, err
	}
	return id, nil
}

// CancelLaunch cancels a pending launch and returns it as it will end. A
// launch that finished before the cancel reached it is returned with its
// final state and no error, so that race stays quiet in the UI.
func (a *App) CancelLaunch(id uuid.UUID) (domain.Launch, error) {
	launch, err := a.Proxy.CancelLaunch(id)
	if errors.Is(err, domain.ErrLaunchFinished) {
		return launch, nil
	}
	return launch, err
}

// GetLaunch returns a launch by id, pending or finished.
func (a *App) GetLaunch(id uuid.UUID) (domain.Launch, error) {
	return a.Proxy.GetLaunch(id)
}

// PendingLaunches returns the launches that have not ended, oldest first.
func (a *App) PendingLaunches() []domain.Launch {
	return a.Proxy.Launches()
}

// configureLaunchHandlers sends launch lifecycle events to the frontend
// through the app's emitter, read when they fire so tests can swap it.
func (a *App) configureLaunchHandlers() {
	a.Proxy.WithOptions(
		marasi.WithLaunchStartedHandler(func(launch domain.Launch) {
			a.emitEvent("launch-started", launch)
		}),
		marasi.WithLaunchFinishedHandler(func(launch domain.Launch) {
			a.emitEvent("launch-finished", launch)
		}),
	)
}
func (a *App) CheckHTTPParse(body string, itemType string) string {
	switch itemType {
	case domain.CheckpointTypeRequest:
		_, err := http.ReadRequest(bufio.NewReader(bytes.NewReader([]byte(body))))
		if err != nil {
			return err.Error()
		}
	case domain.CheckpointTypeResponse:
		_, err := http.ReadResponse(bufio.NewReader(bytes.NewReader([]byte(body))), nil)
		if err != nil {
			return err.Error()
		}
	}
	return ""
}

// TestScopeMatch tests if a URL would be in scope using the same logic as the proxy
func (a *App) TestScopeMatch(urlInput string) map[string]interface{} {
	result := map[string]interface{}{
		"inScope":          false,
		"matchedRule":      "",
		"ruleType":         "",
		"matchedAs":        "",
		"defaultAllowUsed": true,
		"testedUrl":        "",
	}

	// Parse the URL
	parsedURL, err := url.Parse(urlInput)

	// If parsing failed or scheme is missing, try with http:// prefix
	if err != nil || parsedURL.Scheme == "" {
		parsedURL, err = url.Parse("https://" + urlInput)
		if err != nil {
			result["error"] = "Invalid URL: " + err.Error()
			return result
		}
	}

	// Store the actual URL being tested for display
	result["testedUrl"] = parsedURL.String()

	// Create a request with the URL
	req := &http.Request{
		URL:  parsedURL,
		Host: parsedURL.Host,
	}

	// Use the actual Matches method that would be used in the proxy
	result["inScope"] = a.Proxy.Scope.Matches(req)

	// Now determine which specific rule matched

	// Check exclusion rules first - host patterns
	for _, rule := range a.Proxy.Scope.ExcludeRules {
		if rule.MatchType == "host" && rule.Pattern.MatchString(req.Host) {
			result["matchedRule"] = rule.Pattern.String()
			result["ruleType"] = "exclude"
			result["matchedAs"] = "host"
			result["defaultAllowUsed"] = false
			return result
		}
	}

	// Check exclusion rules - URL patterns
	for _, rule := range a.Proxy.Scope.ExcludeRules {
		if rule.MatchType == "url" && rule.Pattern.MatchString(req.URL.String()) {
			result["matchedRule"] = rule.Pattern.String()
			result["ruleType"] = "exclude"
			result["matchedAs"] = "url"
			result["defaultAllowUsed"] = false
			return result
		}
	}

	// Check inclusion rules - host patterns
	for _, rule := range a.Proxy.Scope.IncludeRules {
		if rule.MatchType == "host" && rule.Pattern.MatchString(req.Host) {
			result["matchedRule"] = rule.Pattern.String()
			result["ruleType"] = "include"
			result["matchedAs"] = "host"
			result["defaultAllowUsed"] = false
			return result
		}
	}

	// Check inclusion rules - URL patterns
	for _, rule := range a.Proxy.Scope.IncludeRules {
		if rule.MatchType == "url" && rule.Pattern.MatchString(req.URL.String()) {
			result["matchedRule"] = rule.Pattern.String()
			result["ruleType"] = "include"
			result["matchedAs"] = "url"
			result["defaultAllowUsed"] = false
			return result
		}
	}

	return result
}

// GetScopeRules returns the current scope configuration
func (a *App) GetScopeRules() map[string]interface{} {
	// Direct access to scope
	scope := a.Proxy.Scope

	// Convert include rules to a UI-friendly format
	includeRules := []map[string]string{}
	for key, rule := range scope.IncludeRules {
		includeRules = append(includeRules, map[string]string{
			"id":        key,
			"pattern":   rule.Pattern.String(),
			"matchType": rule.MatchType,
		})
	}

	// Convert exclude rules to a UI-friendly format
	excludeRules := []map[string]string{}
	for key, rule := range scope.ExcludeRules {
		excludeRules = append(excludeRules, map[string]string{
			"id":        key,
			"pattern":   rule.Pattern.String(),
			"matchType": rule.MatchType,
		})
	}

	return map[string]interface{}{
		"includeRules": includeRules,
		"excludeRules": excludeRules,
		"defaultAllow": scope.DefaultAllow,
	}
}

func (a *App) GetLaunchpads() []*domain.Launchpad {
	launchpad, err := a.Proxy.LaunchpadRepo.GetLaunchpads()
	if err != nil {
		return nil
	}
	return launchpad
}

func (a *App) GetLaunchpadRequests(id uuid.UUID) []*domain.RequestResponseSummary {
	launchpadRequest, _, err := a.Proxy.LaunchpadRepo.GetLaunchpadRequests(id, "", nil, "")
	if err != nil {
		return nil
	}
	return launchpadRequest
}

func (a *App) LinkRequestToLaunchpad(requestID uuid.UUID, repeaterID uuid.UUID) {
	err := a.Proxy.LaunchpadRepo.LinkRequestToLaunchpad(requestID, repeaterID)
	if err != nil {
		log.Println(err)
	}
	return
}
func (a *App) CreateLaunchpadEntry(name string, description string) uuid.UUID {
	launchpadUUID, err := a.Proxy.LaunchpadRepo.CreateLaunchpad(name, description)
	if err != nil {
		log.Println(err)
		return uuid.Nil
	}
	return launchpadUUID
}

// DeleteLaunchpad deletes a launchpad unless a launch from it is pending;
// then it returns the launch_pending refusal (see launchpadError).
func (a *App) DeleteLaunchpad(id uuid.UUID) error {
	if err := a.Proxy.DeleteLaunchpad(id); err != nil {
		return launchpadError("deleting launchpad", err)
	}
	return nil
}
func (a *App) UpdateLaunchpadEntry(id uuid.UUID, name string, description string) error {
	err := a.Proxy.LaunchpadRepo.UpdateLaunchpad(id, &name, &description)
	if err != nil {
		return err
	}
	return nil

}
func (a *App) GetExtensionCode(extensionName string) (string, error) {
	code, err := a.Proxy.ExtensionRepo.GetExtensionLuaCodeByName(extensionName)
	if err != nil {
		return "", fmt.Errorf("getting code for %s : %w", extensionName, err)
	}
	return code, nil
}

func (a *App) RunExtension(extensionName string, code string) error {
	extension, ok := a.Proxy.GetExtension(extensionName)
	if !ok {
		return fmt.Errorf("extension %s not found", extensionName)
	}
	err := extension.UpdateLuaContent(a.Proxy.ExtensionRepo, code)
	if err != nil {
		return fmt.Errorf("updating code for %s : %w", extensionName, err)
	}

	err = extension.ExecuteLua(code)
	if err != nil {
		return fmt.Errorf("executing lua code for %s: %w", extensionName, err)
	}
	return nil
}
func (a *App) DoExtender(code string) {
	if err := a.RunExtension("workshop", code); err != nil {
		log.Print(err)
	}
}
func (a *App) GetMetadata(id uuid.UUID) map[string]any {
	note, err := a.Proxy.TrafficRepo.GetMetadata(id)
	if err != nil {
		log.Print(err)
	}
	return note
}
func (a *App) GetNote(id uuid.UUID) string {
	note, err := a.Proxy.TrafficRepo.GetNote(id)
	if err != nil {
		log.Print(err)
	}
	return note
}
func (a *App) UpdateNote(id uuid.UUID, note string) error {
	err := a.Proxy.TrafficRepo.UpdateNote(id, note)
	if err != nil {
		return fmt.Errorf("updating note : %w", err)
	}
	return nil
}
func (a *App) GetInterfaces() ([]string, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("getting interfaces: %w", err)
	}

	var (
		ipv4Slice []string
		ipv6Slice []string
	)

	for _, iface := range interfaces {
		addrs, err := iface.Addrs()
		if err != nil {
			fmt.Println("Error getting addresses:", err)
			continue
		}
		for _, addr := range addrs {
			// Strip off the '/mask' if present
			ipStr := addr.String()
			if strings.Contains(ipStr, "/") {
				ipStr = strings.SplitN(ipStr, "/", 2)[0]
			}

			ip := net.ParseIP(ipStr)
			// If ParseIP fails or returns nil, skip
			if ip == nil {
				continue
			}

			// If ip.To4() != nil, it's IPv4; otherwise, treat as IPv6
			if ip.To4() != nil {
				ipv4Slice = append(ipv4Slice, ipStr)
			} else {
				ipv6Slice = append(ipv6Slice, ipStr)
			}
		}
	}

	// Return IPv4 addresses first, then IPv6
	return append(ipv4Slice, ipv6Slice...), nil
}
func (a *App) GetMarasiConfig() *Config {
	return a.Config
}
func (a *App) GetRecentProjects() []struct {
	ProjectName string
	Date        string
} {
	var recent []struct {
		ProjectName string
		Date        string
	}
	files, err := os.ReadDir(a.Proxy.ConfigDir)
	if err != nil {
		return recent
	}
	for _, file := range files {
		if path.Ext(file.Name()) == ".marasi" {
			fileInfo, err := file.Info()
			if err != nil {
				log.Print(err)
				return recent
			}
			date := fileInfo.ModTime().String()
			fullPath := path.Join(a.Proxy.ConfigDir, file.Name())
			project := struct {
				ProjectName string
				Date        string
			}{
				ProjectName: fullPath,
				Date:        date,
			}
			recent = append(recent, project)
		}
	}
	return recent
}

// Chrome settings live in the machine config shared with service instances,
// so each call rereads it under the shared config lock. A config the reread
// refuses, such as a negative websocket_max_message_size, comes back as
// Marasi's "invalid configuration" error, which the frontend shows.

func (a *App) GetChromeProfiles() ([]string, error) {
	profiles, err := a.chrome.Profiles(context.Background())
	if err != nil {
		return []string{}, fmt.Errorf("reading chrome profiles: %w", err)
	}
	return profiles, nil
}

func (a *App) AddChromeProfile(name string) ([]string, error) {
	profiles, err := a.chrome.AddProfile(context.Background(), name)
	if err != nil {
		return []string{}, err
	}
	return profiles, nil
}

func (a *App) DeleteChromeProfile(name string) ([]string, error) {
	profiles, err := a.chrome.RemoveProfile(context.Background(), name)
	if err != nil {
		return []string{}, err
	}
	return profiles, nil
}

func (a *App) GetChromePaths() ([]chrome.PathConfig, error) {
	paths, err := a.chrome.Paths(context.Background())
	if err != nil {
		return []chrome.PathConfig{}, fmt.Errorf("reading chrome paths: %w", err)
	}
	return paths, nil
}

func (a *App) AddChromePath(path, os string) ([]chrome.PathConfig, error) {
	paths, err := a.chrome.AddPath(context.Background(), chrome.PathConfig{OS: os, Path: path})
	if err != nil {
		return []chrome.PathConfig{}, fmt.Errorf("adding chrome path: %w", err)
	}
	return paths, nil
}

func (a *App) DeleteChromePath(path, os string) ([]chrome.PathConfig, error) {
	paths, err := a.chrome.RemovePath(context.Background(), chrome.PathConfig{OS: os, Path: path})
	if err != nil {
		return []chrome.PathConfig{}, fmt.Errorf("deleting chrome path: %w", err)
	}
	return paths, nil
}

func (a *App) DownloadCert() (bool, error) {
	if a.Proxy.Cert == nil {
		return false, nil
	}

	certPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: a.Proxy.Cert.Raw,
	})

	home, _ := os.UserHomeDir()

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultDirectory: filepath.Join(home, "Downloads"),
		DefaultFilename:  "marasi-proxy.crt",
		Title:            "Save Proxy Certificate",
		Filters: []runtime.FileFilter{
			{DisplayName: "Certificate Files (*.crt)", Pattern: "*.crt"},
			{DisplayName: "PEM Files (*.pem)", Pattern: "*.pem"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})

	if err != nil {
		return false, err
	}

	if path == "" {
		return false, nil
	}

	err = os.WriteFile(path, certPEM, 0600)
	if err != nil {
		return false, err
	}

	return true, nil
}

func (a *App) CopyCertToClipboard() (bool, error) {
	if a.Proxy.Cert == nil {
		return false, fmt.Errorf("certificate is not available")
	}

	certPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: a.Proxy.Cert.Raw,
	})

	err := runtime.ClipboardSetText(a.ctx, string(certPEM))
	if err != nil {
		return false, err
	}

	return true, nil
}

func (a *App) GetUserName() string {
	currentUser, err := user.Current()
	if err != nil {
		return "User"
	}

	if currentUser.Name != "" {
		return currentUser.Name
	}

	return currentUser.Username
}
