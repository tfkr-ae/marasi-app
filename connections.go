package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"maps"
	"net/url"
	"slices"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// Saved connections (spec "App config"): Local, the local connection for
// the `default` instance, which is always there and never saved, and the
// connections the researcher added: local connections for other named
// instances (instance and optional proxy port) and remotes. App config keeps
// each remote's id, name, URL, no-password flag, allowed origins and a
// password reference (keychain.go), never the password; the active
// connection's id; and the recent projects per connection.

const (
	connectionsKey      = "connections"
	activeConnectionKey = "active_connection"
	recentProjectsKey   = "recent_projects"
	localConnectionID   = "local"
	recentProjectsLimit = 10
)

// SavedConnection is one connection as the frontend lists it.
type SavedConnection struct {
	ID             string   `json:"id" yaml:"id"`
	Name           string   `json:"name" yaml:"name"`
	Kind           string   `json:"kind" yaml:"kind"`
	URL            string   `json:"url" yaml:"url"`
	NoPassword     bool     `json:"noPassword" yaml:"no_password"`
	AllowedOrigins []string `json:"allowedOrigins" yaml:"allowed_origins,omitempty"`
	PasswordRef    string   `json:"-" yaml:"password_ref,omitempty"`
	// Instance is the service instance a local connection names.
	Instance string `json:"instance" yaml:"instance,omitempty"`
	// Port is a local connection's proxy port; 0 starts it on any free port.
	Port int `json:"port" yaml:"port,omitempty"`
}

// Connections is the list, local first, and the active connection's id.
type Connections struct {
	Connections []SavedConnection `json:"connections"`
	ActiveID    string            `json:"activeId"`
}

// NewConnection is a remote to add, typed in or read from a pairing payload.
type NewConnection struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	Password   string `json:"password"`
	NoPassword bool   `json:"noPassword"`
}

// NewLocalConnection is a local connection to add: an instance name, picked
// from the CLI's list or typed, and an optional proxy port (0 for any).
type NewLocalConnection struct {
	Name     string `json:"name"`
	Instance string `json:"instance"`
	Port     int    `json:"port"`
}

// RecentProject is a project opened on a connection; Opened is RFC 3339.
type RecentProject struct {
	Name   string `json:"name" yaml:"name"`
	Path   string `json:"path" yaml:"path"`
	Opened string `json:"opened" yaml:"opened"`
}

var localConnection = SavedConnection{ID: localConnectionID, Name: "Local", Kind: "local", Instance: localInstanceName}

func parseConnections(node *yaml.Node) []SavedConnection {
	var saved []SavedConnection
	if node == nil {
		return nil
	}
	if err := node.Decode(&saved); err != nil {
		log.Printf("[!] %s in the app config isn't a list of connections, ignoring it: %v", connectionsKey, err)
		return nil
	}
	return slices.DeleteFunc(saved, func(c SavedConnection) bool {
		return c.ID == "" || c.ID == localConnectionID || (c.Kind == "local" && c.Instance == "")
	})
}

func parseRecentProjects(node *yaml.Node) map[string][]RecentProject {
	recents := map[string][]RecentProject{}
	if node == nil {
		return recents
	}
	if err := node.Decode(&recents); err != nil {
		log.Printf("[!] %s in the app config isn't valid, ignoring it: %v", recentProjectsKey, err)
		return map[string][]RecentProject{}
	}
	return recents
}

func parseActiveConnection(node *yaml.Node) string {
	if node == nil {
		return ""
	}
	return node.Value
}

// remoteURL checks and normalises a remote's control address.
func remoteURL(raw string) (string, error) {
	text := strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(text)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("%q isn't an address such as http://10.0.0.5:9000", raw)
	}
	return text, nil
}

// ListConnections lists the connections, local first, and the active one.
func (a *App) ListConnections() Connections {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return a.connectionsLocked()
}

func (a *App) connectionsLocked() Connections {
	list := append([]SavedConnection{localConnection}, a.Config.connections...)
	active := a.Config.activeConnection
	if a.findConnection(active) < 0 {
		active = localConnectionID
	}
	return Connections{Connections: list, ActiveID: active}
}

// findConnection is the index of the remote `id` in Config.connections, or
// -1. Callers hold Config.mu.
func (a *App) findConnection(id string) int {
	return slices.IndexFunc(a.Config.connections, func(c SavedConnection) bool { return c.ID == id })
}

// remoteConnection is the index of the remote `id` in Config.connections,
// or an error naming it when there is none. Callers hold Config.mu.
func (a *App) remoteConnection(id string) (int, error) {
	return a.savedConnection(id, "remote")
}

// savedConnection is the index of the added connection `id` of kind in
// Config.connections, or an error naming it. Callers hold Config.mu.
func (a *App) savedConnection(id, kind string) (int, error) {
	i := a.findConnection(id)
	if i < 0 || a.Config.connections[i].Kind != kind {
		return -1, fmt.Errorf("no %s connection %s", kind, id)
	}
	return i, nil
}

func newConnectionID(kind string) (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return kind + "-" + hex.EncodeToString(b), nil
}

// instanceName checks a typed instance name as the Marasi CLI does
// (resolveInstancePath): not empty, no path, no .sock suffix.
func instanceName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	switch {
	case name == "":
		return "", errors.New("enter an instance name")
	case name == "." || name == ".." || strings.ContainsAny(name, `/\`):
		return "", fmt.Errorf("%q isn't an instance name: no paths", name)
	case strings.HasSuffix(name, ".sock"):
		return "", fmt.Errorf("%q isn't an instance name: no .sock suffix", name)
	}
	return name, nil
}

func checkPort(port int) error {
	if port < 0 || port > 65535 {
		return fmt.Errorf("port %d isn't 0–65535", port)
	}
	return nil
}

// AddLocalConnection saves a local connection for a named instance on this
// machine, one that isn't saved yet; `default` is Local's.
func (a *App) AddLocalConnection(in NewLocalConnection) (SavedConnection, error) {
	name, err := instanceName(in.Instance)
	if err != nil {
		return SavedConnection{}, err
	}
	if err := checkPort(in.Port); err != nil {
		return SavedConnection{}, err
	}
	id, err := newConnectionID("local")
	if err != nil {
		return SavedConnection{}, err
	}
	label := strings.TrimSpace(in.Name)
	if label == "" {
		label = name
	}
	saved := SavedConnection{ID: id, Name: label, Kind: "local", Instance: name, Port: in.Port}

	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	for _, c := range a.connectionsLocked().Connections {
		if c.Kind == "local" && c.Instance == name {
			return SavedConnection{}, fmt.Errorf("%s already reaches instance %s", c.Name, name)
		}
	}
	if err := a.writeConnections(append(slices.Clone(a.Config.connections), saved)); err != nil {
		return SavedConnection{}, err
	}
	return saved, nil
}

// SetConnectionPort changes an added local connection's proxy port (0 for
// any free port); it applies from the instance's next start.
func (a *App) SetConnectionPort(id string, port int) (SavedConnection, error) {
	if err := checkPort(port); err != nil {
		return SavedConnection{}, err
	}
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	i, err := a.savedConnection(id, "local")
	if err != nil {
		return SavedConnection{}, err
	}
	next := slices.Clone(a.Config.connections)
	next[i].Port = port
	if err := a.writeConnections(next); err != nil {
		return SavedConnection{}, err
	}
	return next[i], nil
}

// AddConnection saves a remote: its password goes to the keychain (or the
// 0600 file), and app config keeps a reference.
func (a *App) AddConnection(in NewConnection) (SavedConnection, error) {
	address, err := remoteURL(in.URL)
	if err != nil {
		return SavedConnection{}, err
	}
	if in.Password == "" && !in.NoPassword {
		return SavedConnection{}, errors.New("enter the service's password, or say it has none")
	}
	id, err := newConnectionID("remote")
	if err != nil {
		return SavedConnection{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = strings.TrimPrefix(strings.TrimPrefix(address, "https://"), "http://")
	}
	saved := SavedConnection{ID: id, Name: name, Kind: "remote", URL: address, NoPassword: in.NoPassword}

	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	if !in.NoPassword {
		if saved.PasswordRef, err = a.storePassword(id, in.Password); err != nil {
			return SavedConnection{}, err
		}
	}
	next := append(slices.Clone(a.Config.connections), saved)
	if err := a.writeConnections(next); err != nil {
		_ = a.forgetPassword(saved.PasswordRef)
		return SavedConnection{}, err
	}
	return saved, nil
}

// SetConnectionAddress changes a remote's control address.
func (a *App) SetConnectionAddress(id, address string) (SavedConnection, error) {
	normalised, err := remoteURL(address)
	if err != nil {
		return SavedConnection{}, err
	}
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	i, err := a.remoteConnection(id)
	if err != nil {
		return SavedConnection{}, err
	}
	next := slices.Clone(a.Config.connections)
	next[i].URL = normalised
	if err := a.writeConnections(next); err != nil {
		return SavedConnection{}, err
	}
	return next[i], nil
}

// SetConnectionPassword replaces a remote's password, as after the service
// refused the saved one.
func (a *App) SetConnectionPassword(id, password string) error {
	if password == "" {
		return errors.New("enter the password")
	}
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	i, err := a.remoteConnection(id)
	if err != nil {
		return err
	}
	ref, err := a.storePassword(id, password)
	if err != nil {
		return err
	}
	next := slices.Clone(a.Config.connections)
	if old := next[i].PasswordRef; old != "" && old != ref {
		if err := a.forgetPassword(old); err != nil {
			log.Printf("[!] forgetting the old password for %s: %v", id, err)
		}
	}
	next[i].PasswordRef = ref
	next[i].NoPassword = false
	next[i].AllowedOrigins = nil
	return a.writeConnections(next)
}

// SetConnectionNoPassword records that a remote's service no longer has a
// password, after the app removed it there: the saved secret goes, and the
// connection keeps the origins the service now allows. Never the default.
func (a *App) SetConnectionNoPassword(id string, origins []string) error {
	if len(origins) == 0 {
		return errors.New("add at least one origin")
	}
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	i, err := a.remoteConnection(id)
	if err != nil {
		return err
	}
	next := slices.Clone(a.Config.connections)
	old := next[i].PasswordRef
	next[i].PasswordRef = ""
	next[i].NoPassword = true
	next[i].AllowedOrigins = slices.Clone(origins)
	if err := a.writeConnections(next); err != nil {
		return err
	}
	if err := a.forgetPassword(old); err != nil {
		log.Printf("[!] forgetting the password for %s: %v", id, err)
	}
	return nil
}

// ConnectionPassword is a remote's saved password; "" when it has none.
func (a *App) ConnectionPassword(id string) (string, error) {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	i, err := a.remoteConnection(id)
	if err != nil {
		return "", err
	}
	c := a.Config.connections[i]
	if c.NoPassword {
		return "", nil
	}
	password, err := a.loadPassword(c.PasswordRef)
	if err != nil {
		return "", fmt.Errorf("reading the password for %s: %w", c.Name, err)
	}
	return password, nil
}

// RemoveConnection forgets an added connection, its recent projects and a
// remote's password or a local connection's owned run (the app stops
// managing that instance; it keeps running). Local and the active one stay.
func (a *App) RemoveConnection(id string) error {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	if id == localConnectionID {
		return errors.New("the local connection can't be removed")
	}
	i := a.findConnection(id)
	if i < 0 {
		return fmt.Errorf("no connection %s", id)
	}
	if a.Config.activeConnection == id {
		return errors.New("switch to another connection first")
	}
	removed := a.Config.connections[i]
	next := slices.Delete(slices.Clone(a.Config.connections), i, i+1)
	recents := cloneRecents(a.Config.recentProjects)
	delete(recents, id)
	runs := maps.Clone(a.Config.ownedRuns)
	delete(runs, id)
	if runs == nil {
		runs = map[string]string{}
	}
	if err := writeConfigKeys(a.Config.path(), map[string]any{connectionsKey: next, recentProjectsKey: recents, ownedRunsKey: runs}); err != nil {
		return fmt.Errorf("saving connections: %w", err)
	}
	a.Config.connections = next
	a.Config.recentProjects = recents
	a.Config.ownedRuns = runs
	if err := a.forgetPassword(removed.PasswordRef); err != nil {
		log.Printf("[!] forgetting the password for %s: %v", id, err)
	}
	return nil
}

// SetActiveConnection saves the connection the app reaches on start.
func (a *App) SetActiveConnection(id string) error {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	if id != localConnectionID && a.findConnection(id) < 0 {
		return fmt.Errorf("no connection %s", id)
	}
	if err := writeConfigKeys(a.Config.path(), map[string]any{activeConnectionKey: id}); err != nil {
		return fmt.Errorf("saving the active connection: %w", err)
	}
	a.Config.activeConnection = id
	return nil
}

// RecentProjects lists the projects opened on connection `id`, latest first.
func (a *App) RecentProjects(id string) []RecentProject {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return slices.Clone(a.Config.recentProjects[id])
}

// AddRecentProject records that `path` opened on connection `id`.
func (a *App) AddRecentProject(id, name, path string) error {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	if id != localConnectionID && a.findConnection(id) < 0 {
		return fmt.Errorf("no connection %s", id)
	}
	entry := RecentProject{Name: name, Path: path, Opened: time.Now().UTC().Format(time.RFC3339)}
	list := slices.DeleteFunc(slices.Clone(a.Config.recentProjects[id]), func(r RecentProject) bool { return r.Path == path })
	list = append([]RecentProject{entry}, list...)
	if len(list) > recentProjectsLimit {
		list = list[:recentProjectsLimit]
	}
	recents := cloneRecents(a.Config.recentProjects)
	recents[id] = list
	if err := writeConfigKeys(a.Config.path(), map[string]any{recentProjectsKey: recents}); err != nil {
		return fmt.Errorf("saving recent projects: %w", err)
	}
	a.Config.recentProjects = recents
	return nil
}

func cloneRecents(recents map[string][]RecentProject) map[string][]RecentProject {
	next := make(map[string][]RecentProject, len(recents))
	for id, list := range recents {
		next[id] = slices.Clone(list)
	}
	return next
}

// writeConnections saves the added connections. Callers hold Config.mu.
func (a *App) writeConnections(next []SavedConnection) error {
	if err := writeConfigKeys(a.Config.path(), map[string]any{connectionsKey: next}); err != nil {
		return fmt.Errorf("saving connections: %w", err)
	}
	a.Config.connections = next
	return nil
}
