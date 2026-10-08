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
	"strconv"
	"strings"
	"time"

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
	ctx      context.Context
	Proxy    *marasi.Proxy
	listener service.ListenerLifecycle
	projects *service.ProjectLifecycle
	Config   *Config
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
	listener, projects := newLifecycles(Proxy, appConfigDir, wordlists, log.Writer(), Proxy.Logger)
	return &App{
		Proxy:    Proxy,
		Config:   config,
		listener: listener,
		projects: projects,
	}
}

// newLifecycles binds the project to the listener so listener shutdown
// interrupts project Lua before draining the requests it may be holding.
func newLifecycles(proxy *marasi.Proxy, configDir string, wordlists wordlist.Provider, logWriter io.Writer, logger *slog.Logger) (service.ListenerLifecycle, *service.ProjectLifecycle) {
	listener := service.NewListenerLifecycle(proxy, logWriter)
	projects := service.NewProjectLifecycle(proxy, configDir, wordlists, logger)
	listener.BindProject(projects)
	return listener, projects
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	logHandler := NewLogHandler(ctx)
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
		marasi.WithInterceptHandler(func(item domain.CheckpointItem) error {
			runtime.EventsEmit(a.ctx, "intercepted", item.Type)
			return nil
		}),
		marasi.WithLogger(logHandler),
	)
	a.configureWebSocketHandlers()
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

	confirmed, err := a.confirmCancelArmoryRuns("Switch Project")
	if err != nil {
		return "", err
	}
	if !confirmed {
		return "", errors.New("project switch cancelled")
	}
	if err := a.projects.Open(context.Background(), filePath); err != nil {
		return "", err
	}
	if err := recoverInterruptedArmoryRuns(a.Proxy.Armory.Repo()); err != nil {
		log.Printf("recovering interrupted armory runs: %v", err)
	}
	base := filepath.Base(filePath)
	projectName := strings.TrimSuffix(base, filepath.Ext(base))
	return projectName, nil
}
func (a *App) SetupScratchpad() error {
	scratchPad := path.Join(a.Proxy.ConfigDir, "scratchpad.marasi")
	if err := a.projects.Open(context.Background(), scratchPad); err != nil {
		return err
	}
	if err := recoverInterruptedArmoryRuns(a.Proxy.Armory.Repo()); err != nil {
		log.Printf("recovering interrupted armory runs: %v", err)
	}
	return nil
}
func (a *App) close(ctx context.Context) {
	_ = a.listener.Shutdown()
	if a.projects != nil {
		if err := a.projects.Shutdown(); err != nil {
			log.Printf("releasing open project: %v", err)
		}
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	confirmed, err := a.confirmCancelArmoryRuns("Close Marasi")
	if err != nil {
		log.Printf("cancelling active Armory runs: %v", err)
	}
	return err != nil || !confirmed
}

func (a *App) confirmCancelArmoryRuns(action string) (bool, error) {
	if a.Proxy.Armory == nil || len(a.Proxy.Armory.ActiveRunIDs()) == 0 {
		return true, nil
	}

	result, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.WarningDialog,
		Title:         action,
		Message:       action + " will cancel all active Armory runs. Continue?",
		Buttons:       []string{"Cancel", action},
		DefaultButton: "Cancel",
		CancelButton:  "Cancel",
	})
	if err != nil || result != action {
		return false, err
	}

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
func (a *App) GetProxyItems() []*domain.RequestResponseSummary {
	resultsSlice, err := a.Proxy.TrafficRepo.GetRequestResponseSummary()
	if err != nil {
		log.Print(fmt.Errorf("getting proxy items: %w", err))
		return nil
	}
	return resultsSlice
}

func (a *App) GetRawDetails(id uuid.UUID) *domain.RequestResponseRow {
	row, err := a.Proxy.TrafficRepo.GetRequestResponseRow(id)
	if err != nil {
		log.Print(err)
	}
	return row
}

func (a *App) GetFilters() []string {
	results, err := a.Proxy.ConfigRepo.GetFilters()
	if err != nil {
		log.Print(err)
		return []string{}
	}
	return results
}

func (a *App) SetFilters(updated []string) error {
	err := a.Proxy.ConfigRepo.SetFilters(updated)
	if err != nil {
		return fmt.Errorf("setting filters : %w", err)
	}
	return nil
}

type ExtensionUI struct {
	UICode  string
	Version string
}

type Dashboard struct {
	Notes         int
	Launchpads    int
	Interceptions int
}

func (a *App) CountNotes() (Dashboard, error) {
	dashboard := Dashboard{}
	count, err := a.Proxy.StatsRepo.CountNotes()
	if err != nil {
		return dashboard, fmt.Errorf("counting notes : %w", err)
	}
	dashboard.Notes = count
	launchpads, err := a.Proxy.StatsRepo.CountLaunchpads()
	if err != nil {
		return dashboard, fmt.Errorf("counting launchpads : %w", err)
	}
	dashboard.Launchpads = launchpads
	intercepted, err := a.Proxy.StatsRepo.CountIntercepted()
	if err != nil {
		return dashboard, fmt.Errorf("counting launchpads : %w", err)
	}
	dashboard.Interceptions = intercepted
	return dashboard, nil
}
func (a *App) StartBrowser(profile string) error {
	err := a.Proxy.StartChrome(profile)
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

func (a *App) GetCheckpointItems() []domain.CheckpointItem {
	return a.Proxy.CheckpointItems()
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
			return fmt.Errorf("%w: %s", marasi.ErrCheckpointNotFound, id)
		}
		raw := []byte(body)
		if item.Type == domain.CheckpointTypeWebSocket {
			fwd.Payload = &raw
		} else {
			fwd.Raw = &raw
		}
	}
	return a.Proxy.ForwardCheckpoint(id, fwd)
}

func (a *App) DropCheckpoint(id uuid.UUID) error {
	return a.Proxy.DropCheckpoint(id)
}
func (a *App) Repeat(raw string, repeaterId string, useHttps bool) {
	err := a.Proxy.Launch(raw, repeaterId, useHttps)
	if err != nil {
		log.Println(err)
	}
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

func (a *App) HighlightRow(id uuid.UUID, colorCode int) error {
	metadata, err := a.Proxy.TrafficRepo.GetMetadata(id)
	if err != nil {
		return fmt.Errorf("getting metadata for request %s : %w", id.String(), err)
	}
	switch colorCode {
	case -1:
		delete(metadata, "highlight")
	default:
		metadata["highlight"] = fmt.Sprintf("#%06X", colorCode)
	}
	err = a.Proxy.TrafficRepo.UpdateMetadata(metadata, id)
	if err != nil {
		return fmt.Errorf("updating metadata for id %s : %w", id.String(), err)
	}
	return nil
}

func (a *App) GetLaunchpads() []*domain.Launchpad {
	launchpad, err := a.Proxy.LaunchpadRepo.GetLaunchpads()
	if err != nil {
		return nil
	}
	return launchpad
}

func (a *App) GetLaunchpadRequests(id uuid.UUID) []*domain.RequestResponseSummary {
	launchpadRequest, err := a.Proxy.LaunchpadRepo.GetLaunchpadRequests(id)
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

func (a *App) DeleteLaunchpad(id uuid.UUID) error {
	err := a.Proxy.LaunchpadRepo.DeleteLaunchpad(id)
	if err != nil {
		return err
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

func (a *App) GetChromeProfiles() []string {
	return a.Proxy.Config.ChromeProfiles
}

func (a *App) AddChromeProfile(name string) ([]string, error) {
	err := a.Proxy.Config.AddChromeProfile(name)
	if err != nil {
		return []string{}, err
	}
	return a.Proxy.Config.ChromeProfiles, nil
}

func (a *App) DeleteChromeProfile(name string) ([]string, error) {
	err := a.Proxy.Config.DeleteChromeProfile(name)
	if err != nil {
		return []string{}, err
	}
	return a.Proxy.Config.ChromeProfiles, nil
}

func (a *App) GetChromePaths() []chrome.PathConfig {
	return a.Proxy.Config.ChromeDirs
}

func (a *App) AddChromePath(path, os string) []chrome.PathConfig {
	err := a.Proxy.Config.AddChromePath(path, os)
	if err != nil {
		// Return something useful here
		return []chrome.PathConfig{}
	}
	return a.Proxy.Config.ChromeDirs
}

func (a *App) DeleteChromePath(path, os string) []chrome.PathConfig {
	err := a.Proxy.Config.DeleteChromePath(path, os)
	if err != nil {
		// Return something useful here
		return []chrome.PathConfig{}
	}
	return a.Proxy.Config.ChromeDirs
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
