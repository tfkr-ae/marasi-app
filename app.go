package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/tfkr-ae/marasi/db"

	marasi "github.com/tfkr-ae/marasi"

	"github.com/Shopify/go-lua"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx      context.Context
	Proxy    *marasi.Proxy
	Listener net.Listener
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
	Proxy, err := marasi.New(
		marasi.WithConfigDir(appConfigDir),
	)
	if err != nil {
		log.Fatal(err)
	}
	return &App{Proxy: Proxy, Config: config}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.Proxy.WithOptions(
		marasi.WithRequestHandler(func(req marasi.ProxyRequest) error {
			runtime.EventsEmit(a.ctx, "request", req)
			return nil
		}),
		marasi.WithResponseHandler(func(res marasi.ProxyResponse) error {
			runtime.EventsEmit(a.ctx, "response", res)
			return nil
		}),
		marasi.WithLogHandler(func(logItem marasi.Log) error {
			runtime.EventsEmit(a.ctx, "log", logItem)
			return nil
		}),
		marasi.WithInterceptHandler(func(intercepted *marasi.Intercepted) error {
			switch intercepted.Type {
			case "request":
				runtime.EventsEmit(a.ctx, "intercepted", "request")
			case "response":
				runtime.EventsEmit(a.ctx, "intercepted", "response")
			}
			return nil
		}),
	)
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
	err := a.Proxy.Repo.DeleteWaypoint(host)
	if err != nil {
		return err
	}
	err = a.Proxy.SyncWaypoints()
	if err != nil {
		return err
	}
	return nil
}

func (a *App) GetInterceptFlag() bool {
	return a.Proxy.InterceptFlag
}

func (a *App) InterceptResponse() {
	if len(a.Proxy.InterceptedQueue) > 0 {
		item := a.Proxy.InterceptedQueue[0]
		// No need to check really because the value is ignored if it is a response
		a.Proxy.InterceptedQueue = a.Proxy.InterceptedQueue[1:]
		item.Channel <- marasi.InterceptionTuple{Resume: true, ShouldInterceptResponse: true}
	}
}
func (a *App) ToggleIntercept() bool {
	a.Proxy.InterceptFlag = !a.Proxy.InterceptFlag
	return a.Proxy.InterceptFlag
}
func (a *App) GetExtensionLogs(name string) ([]marasi.ExtensionLog, error) {
	if extension, ok := a.Proxy.Extensions[name]; ok {
		return extension.Logs, nil
	}
	return []marasi.ExtensionLog{}, fmt.Errorf("extension %s not found", name)
}
func (a *App) CreateWaypoint(host string, override string) error {
	err := a.Proxy.Repo.CreateOrUpdateWaypoint(host, override)
	if err != nil {
		return err
	}
	err = a.Proxy.SyncWaypoints()
	if err != nil {
		return err
	}
	return nil
}
func (a *App) GetWaypoints() (map[string]string, error) {
	waypoints, err := a.Proxy.Repo.GetWaypoints()
	if err != nil {
		return nil, err
	}
	return waypoints, nil
}
func (a *App) UninstallExtension(name string) error {
	return a.Proxy.RemoveExtension(name)
}
func (a *App) CheckExtensionUpdates() map[string]bool {
	return a.Proxy.CheckExtensionUpdates()
}

// Utility function to detect if the listener was closed cleanly
func isListenerClosed(err error) bool {
	if err == nil {
		return true
	}
	// Customize this check to identify errors that are expected on listener close
	return strings.Contains(err.Error(), "use of closed network connection")
}

func (a *App) LoadExtensions() error {
	extensions, err := a.Proxy.Repo.GetExtensions()
	if err != nil {
		return fmt.Errorf("getting extensions : %w", err)
	}
	for _, extension := range extensions {
		// I hate this
		err := a.Proxy.WithOptions(marasi.WithExtension(extension, marasi.ExtensionWithLogHandler(func(log marasi.ExtensionLog) error {
			runtime.EventsEmit(a.ctx, fmt.Sprintf("%s-log", extension.Name), log)
			return nil
		}), func(e *marasi.Extension) error {
			e.LuaState.PushString("marasiapp")
			e.LuaState.SetGlobal("app")
			return nil
		}, func(e *marasi.Extension) error {
			// Create the toast function
			toastFunc := func(l *lua.State) int {
				// const toastSettings = {
				//     message:"Updated Workshop",
				//     background: "variant-filled-success"
				// };
				// toastStore.trigger(toastSettings);
				// }).catch((error) => {
				message := lua.CheckString(l, 1)
				background := lua.CheckString(l, 2)
				runtime.EventsEmit(a.ctx, "extension-toast", message, background)
				return 0
			}
			e.LuaState.Register("toast", toastFunc)
			return nil
		}, func(e *marasi.Extension) error {
			// Test to register an extension icon in the menu
			registerIcon := func(l *lua.State) int {
				componentString := lua.CheckString(l, 1)
				log.Print(componentString)
				// Maybe we can use the name so that it is extension specific?
				runtime.EventsEmit(a.ctx, "extension-icon", extension.Name, componentString)
				runtime.WindowExecJS(a.ctx, "console.log('hello')")
				return 0
			}
			e.LuaState.Register("RegisterIcon", registerIcon)
			return nil
		}))
		if err != nil {
			return fmt.Errorf("applying options to %s : %w", extension.Name, err)
		}
	}
	return nil
}
func (a *App) StartProxy(addr string, port string) error {
	if a.Listener != nil {
		if err := a.StopProxy(); err != nil {
			return fmt.Errorf("error stopping existing listener: %w", err)
		}
	}
	a.Proxy.WithOptions(marasi.WithTLS())
	listener, err := a.Proxy.GetListener(addr, port)
	if err != nil {
		log.Print(err)
		return fmt.Errorf("getting listener on %s:%s", addr, port)
	}
	a.Listener = listener
	go func() {
		err := a.Proxy.Serve(listener)
		if err != nil && !isListenerClosed(err) {
			log.Printf("proxy error : %v", err)
		}
	}()
	return nil

}

func (a *App) StopProxy() error {
	if a.Listener == nil {
		return nil // Listener already stopped
	}

	// Close the listener to stop accepting new connections
	err := a.Listener.Close()
	if err != nil {
		return fmt.Errorf("error stopping listener: %w", err)
	}
	// Cleanup
	a.Listener = nil
	return nil
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

	dbConn, err := db.New(filePath)
	if err != nil {
		return "", fmt.Errorf("setting up repo %s : %w", filePath, err)
	}
	Repo := db.NewProxyRepo(dbConn)
	a.Proxy.WithOptions(marasi.WithRepo(Repo))
	base := filepath.Base(filePath)
	projectName := strings.TrimSuffix(base, filepath.Ext(base))
	return projectName, nil
}
func (a *App) SetupScratchpad() error {
	scratchPad := path.Join(a.Proxy.ConfigDir, "scratchpad.marasi")
	dbConn, err := db.New(scratchPad)
	if err != nil {
		return fmt.Errorf("setting up repo %s : %w", scratchPad, err)
	}
	Repo := db.NewProxyRepo(dbConn)
	err = a.Proxy.WithOptions(marasi.WithRepo(Repo))
	if err != nil {
		return err
	}
	return nil

}
func (a *App) close(ctx context.Context) {
	a.Proxy.Close()
}

func (a *App) GetLogs() ([]marasi.Log, error) {
	logs, err := a.Proxy.Repo.GetLogs()
	if err != nil {
		return []marasi.Log{}, fmt.Errorf("getting logs : %w", err)
	}
	return logs, nil
}
func (a *App) GetProxyItems() map[uuid.UUID]marasi.Row {
	results, err := a.Proxy.Repo.GetItems()
	if err != nil {
		log.Print(fmt.Errorf("getting proxy items : %w", err))
	}
	return results
}

func (a *App) GetRawDetails(id uuid.UUID) marasi.Row {
	row, err := a.Proxy.Repo.GetRaw(id)
	if err != nil {
		log.Print(err)
	}
	return row
}

// TODO  - Shift to proxy after
func (a *App) DownloadExtension(url string, direct bool) {
	err := a.Proxy.InstallExtension(url, direct)
	if err != nil {
		log.Print(err)
	}
}

func (a *App) GetFilters() []string {
	results, err := a.Proxy.Repo.GetFilters()
	if err != nil {
		log.Print(err)
		return []string{}
	}
	return results
}

func (a *App) SetFilters(updated []string) error {
	err := a.Proxy.Repo.SetFilters(updated)
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
	Notes         int32
	Launchpads    int32
	Interceptions int32
}

func (a *App) CountNotes() (Dashboard, error) {
	dashboard := Dashboard{}
	count, err := a.Proxy.Repo.CountNotes()
	if err != nil {
		return dashboard, fmt.Errorf("counting notes : %w", err)
	}
	dashboard.Notes = count
	launchpads, err := a.Proxy.Repo.CountLaunchpads()
	if err != nil {
		return dashboard, fmt.Errorf("counting launchpads : %w", err)
	}
	dashboard.Launchpads = launchpads
	intercepted, err := a.Proxy.Repo.CountIntercepted()
	if err != nil {
		return dashboard, fmt.Errorf("counting launchpads : %w", err)
	}
	dashboard.Interceptions = intercepted
	log.Print(dashboard)
	return dashboard, nil
}
func (a *App) StartBrowser() error {
	err := a.Proxy.StartChrome()
	if err != nil {
		return fmt.Errorf("starting chrome : %w", err)
	}
	return nil
}
func (a *App) GetExtensionUI(extensionName string) (extUI ExtensionUI) {
	if extension, ok := a.Proxy.Extensions[extensionName]; ok {
		ui, err := extension.GetGlobalFlag("ui_code")
		if err != nil {
			log.Print(err)
			return extUI
		}
		version, err := extension.GetGlobalFlag("version")
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
	if extension, ok := a.Proxy.Extensions[extensionName]; ok {
		return extension.CheckGlobalFlag(flagName), nil
	}
	return false, fmt.Errorf("checking if %s exists", extensionName)
}
func (a *App) GetResponse(id uuid.UUID) marasi.ProxyResponse {
	response, err := a.Proxy.Repo.GetResponse(id)
	if err != nil {
		log.Print(err)
		return marasi.ProxyResponse{}
	}
	return response
}

type InterceptedResult struct {
	Raw  string `json:"raw"`
	Type string `json:"type"`
}

func (a *App) GetIntercepted() InterceptedResult {
	if len(a.Proxy.InterceptedQueue) > 0 {
		intercepted := a.Proxy.InterceptedQueue[0]
		return InterceptedResult{
			Raw:  intercepted.Raw,
			Type: intercepted.Type,
		}
	}
	return InterceptedResult{}
}

func (a *App) DropIntercepted() {
	if len(a.Proxy.InterceptedQueue) > 0 {
		item := a.Proxy.InterceptedQueue[0]
		a.Proxy.InterceptedQueue = a.Proxy.InterceptedQueue[1:]
		item.Channel <- marasi.InterceptionTuple{Resume: false, ShouldInterceptResponse: false}
	}
}
func (a *App) Repeat(raw string, repeaterId string, useHttps bool) {
	err := a.Proxy.Launch(raw, repeaterId, useHttps)
	if err != nil {
		log.Println(err)
	}
}
func (a *App) ForwardIntercepted(body string) {
	if len(a.Proxy.InterceptedQueue) > 0 {
		item := a.Proxy.InterceptedQueue[0]
		switch item.Type {
		case "request":
			_, err := http.ReadRequest(bufio.NewReader(bytes.NewReader([]byte(body))))
			if err != nil {
				log.Print(err)
				return
			}
		case "response":
			_, err := http.ReadResponse(bufio.NewReader(bytes.NewReader([]byte(body))), nil)
			if err != nil {
				log.Print(err)
				return
			}
		}
		item.Raw = body
		a.Proxy.InterceptedQueue = a.Proxy.InterceptedQueue[1:]
		item.Channel <- marasi.InterceptionTuple{Resume: true, ShouldInterceptResponse: false}
	}
}

func (a *App) GetInterceptedQueue() int {
	return len(a.Proxy.InterceptedQueue)
}

func (a *App) CheckHTTPParse(body string) string {
	if len(a.Proxy.InterceptedQueue) > 0 {
		item := a.Proxy.InterceptedQueue[0]
		switch item.Type {
		case "request":
			_, err := http.ReadRequest(bufio.NewReader(bytes.NewReader([]byte(body))))
			if err != nil {
				log.Print(err)
				return err.Error()
			}
		case "response":
			_, err := http.ReadResponse(bufio.NewReader(bytes.NewReader([]byte(body))), nil)
			if err != nil {
				log.Print(err)
				return err.Error()
			}
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
	metadata, err := a.Proxy.Repo.GetMetadata(id)
	if err != nil {
		return fmt.Errorf("getting metadata for request %s : %w", id.String(), err)
	}
	log.Print(metadata)
	switch colorCode {
	case -1:
		delete(metadata, "Highlight")
	default:
		metadata["Highlight"] = fmt.Sprintf("#%06X", colorCode)
	}
	err = a.Proxy.Repo.UpdateMetadata(metadata, id)
	if err != nil {
		return fmt.Errorf("updating metadata for id %s : %w", id.String(), err)
	}
	return nil
}

func (a *App) GetExtensions() map[string]*marasi.Extension {
	return a.Proxy.Extensions
}
func (a *App) GetRepeaterTabs() []marasi.Launchpad {
	repeater, err := a.Proxy.Repo.GetLaunchpads()
	if err != nil {
		return []marasi.Launchpad{}
	}
	return repeater
}

func (a *App) GetRepeaterRequests(id uuid.UUID) []marasi.ProxyRequest {
	repeaterRequests, err := a.Proxy.Repo.GetLaunchpadRequests(id)
	if err != nil {
		log.Println(err)
		return []marasi.ProxyRequest{}
	}
	return repeaterRequests
}

func (a *App) LinkRequestToRepeater(requestID uuid.UUID, repeaterID uuid.UUID) {
	err := a.Proxy.Repo.LinkRequestToLaunchpad(requestID, repeaterID)
	if err != nil {
		log.Println(err)
	}
	return
}
func (a *App) CreateRepeaterEntry(name string, description string) uuid.UUID {
	repeaterUUID, err := a.Proxy.Repo.CreateLaunchpad(name, description)
	if err != nil {
		log.Println(err)
		return uuid.Nil
	}
	return repeaterUUID
}

func (a *App) DeleteRepeaterEntry(id uuid.UUID) error {
	err := a.Proxy.Repo.DeleteLaunchpad(id)
	if err != nil {
		return err
	}
	return nil
}
func (a *App) UpdateRepeaterEntry(id uuid.UUID, name string, description string) error {
	err := a.Proxy.Repo.UpdateLaunchpad(id, name, description)
	if err != nil {
		return err
	}
	return nil

}
func (a *App) GetExtensionCode(extensionName string) (string, error) {
	code, err := a.Proxy.Repo.GetExtensionLuaCode(extensionName)
	if err != nil {
		return "", fmt.Errorf("getting code for %s : %w", extensionName, err)
	}
	return code, nil
}

func (a *App) RunExtension(extensionName string, code string) error {
	err := a.Proxy.Repo.UpdateLuaCode(extensionName, code)
	if err != nil {
		return fmt.Errorf("updating code for %s : %w", extensionName, err)
	}
	extension, ok := a.Proxy.Extensions[extensionName]
	if !ok {
		return fmt.Errorf("extension %s not found", extensionName)
	}

	err = extension.ExecuteLua(code)
	if err != nil {
		return fmt.Errorf("executing lua code for %s: %w", extensionName, err)
	}
	return nil
}
func (a *App) DoExtender(code string) {
	err := a.Proxy.Repo.UpdateLuaCode("workshop", code)
	if err != nil {
		log.Print(err)
	}
	err = a.Proxy.Extensions["workshop"].ExecuteLua(code)
	log.Print(err)
}
func (a *App) GetMetadata(id uuid.UUID) marasi.Metadata {
	note, err := a.Proxy.Repo.GetMetadata(id)
	if err != nil {
		log.Print(err)
	}
	return note
}
func (a *App) GetNote(id uuid.UUID) string {
	note, err := a.Proxy.Repo.GetNote(id)
	if err != nil {
		log.Print(err)
	}
	return note
}
func (a *App) UpdateNote(id uuid.UUID, note string) error {
	err := a.Proxy.Repo.UpdateNote(id, note)
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

func (a *App) GetChromePaths() []marasi.ChromePathConfig {
	return a.Proxy.Config.ChromeDirs
}

func (a *App) AddChromePath(path, os string) []marasi.ChromePathConfig {
	err := a.Proxy.Config.AddChromePath(path, os)
	if err != nil {
		// Return something useful here
		return []marasi.ChromePathConfig{}
	}
	return a.Proxy.Config.ChromeDirs
}

func (a *App) DeleteChromePath(path, os string) []marasi.ChromePathConfig {
	err := a.Proxy.Config.DeleteChromePath(path, os)
	if err != nil {
		// Return something useful here
		return []marasi.ChromePathConfig{}
	}
	return a.Proxy.Config.ChromeDirs
}
