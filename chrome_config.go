package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/tfkr-ae/marasi/chrome"
	"go.yaml.in/yaml/v3"
)

// The Chrome paths and profiles Start Chrome uses live in the app config,
// whatever the connection: Chrome runs on this machine.
const (
	chromePathsKey    = "chrome_paths"
	chromeProfilesKey = "chrome_profiles"
)

var (
	errChromeNotFound      = errors.New("not found")
	errChromeAlreadyExists = errors.New("already exists")
	errChromeInvalid       = errors.New("invalid")
)

// chromePathEntry is a Chrome path as the app config stores it.
type chromePathEntry struct {
	OS   string `yaml:"os"`
	Path string `yaml:"path"`
}

// validChromePath reports whether path names an executable for an OS the
// launcher knows.
func validChromePath(path chrome.PathConfig) bool {
	if strings.TrimSpace(path.Path) == "" {
		return false
	}
	switch path.OS {
	case "darwin", "linux", "windows":
		return true
	default:
		return false
	}
}

// validProfileName trims name and refuses one that isn't a single directory
// name, since the profile names its user-data directory.
func validProfileName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || !filepath.IsLocal(name) || filepath.Base(name) != name {
		return "", fmt.Errorf("chrome profile %q: %w name", name, errChromeInvalid)
	}
	return name, nil
}

func parseChromePaths(node *yaml.Node) []chrome.PathConfig {
	out := []chrome.PathConfig{}
	if node == nil {
		return out
	}
	var entries []chromePathEntry
	if err := node.Decode(&entries); err != nil {
		log.Printf("[!] %s section unusable, ignoring it: %v", chromePathsKey, err)
		return out
	}
	for _, entry := range entries {
		path := chrome.PathConfig{OS: entry.OS, Path: entry.Path}
		if validChromePath(path) && !slices.Contains(out, path) {
			out = append(out, path)
		}
	}
	return out
}

func parseChromeProfiles(node *yaml.Node) []string {
	out := []string{}
	if node == nil {
		return out
	}
	var names []string
	if err := node.Decode(&names); err != nil {
		log.Printf("[!] %s section unusable, ignoring it: %v", chromeProfilesKey, err)
		return out
	}
	for _, name := range names {
		if valid, err := validProfileName(name); err == nil && !slices.Contains(out, valid) {
			out = append(out, valid)
		}
	}
	return out
}

// writeChromePaths saves paths and makes them the live list. Callers hold mu.
func (cfg *Config) writeChromePaths(paths []chrome.PathConfig) error {
	entries := make([]chromePathEntry, len(paths))
	for i, path := range paths {
		entries[i] = chromePathEntry{OS: path.OS, Path: path.Path}
	}
	if err := writeConfigKeys(cfg.path(), map[string]any{chromePathsKey: entries}); err != nil {
		return fmt.Errorf("saving chrome paths: %w", err)
	}
	cfg.chromePaths = paths
	return nil
}

// writeChromeProfiles saves profiles and makes them the live list. Callers
// hold mu.
func (cfg *Config) writeChromeProfiles(profiles []string) error {
	if err := writeConfigKeys(cfg.path(), map[string]any{chromeProfilesKey: profiles}); err != nil {
		return fmt.Errorf("saving chrome profiles: %w", err)
	}
	cfg.chromeProfiles = profiles
	return nil
}

// GetChromePaths returns the Chrome executables Start Chrome tries first.
func (a *App) GetChromePaths() ([]chrome.PathConfig, error) {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return slices.Clone(a.Config.chromePaths), nil
}

// AddChromePath adds a Chrome executable for os and returns the paths.
func (a *App) AddChromePath(path, os string) ([]chrome.PathConfig, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	entry := chrome.PathConfig{OS: os, Path: strings.TrimSpace(path)}
	switch {
	case !validChromePath(entry):
		return slices.Clone(cfg.chromePaths), fmt.Errorf("adding chrome path: %w path or OS", errChromeInvalid)
	case slices.Contains(cfg.chromePaths, entry):
		return slices.Clone(cfg.chromePaths), fmt.Errorf("adding chrome path %s: %w", entry.Path, errChromeAlreadyExists)
	}
	if err := cfg.writeChromePaths(append(slices.Clone(cfg.chromePaths), entry)); err != nil {
		return slices.Clone(cfg.chromePaths), err
	}
	return slices.Clone(cfg.chromePaths), nil
}

// DeleteChromePath removes a Chrome executable and returns the paths.
func (a *App) DeleteChromePath(path, os string) ([]chrome.PathConfig, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	entry := chrome.PathConfig{OS: os, Path: path}
	if !slices.Contains(cfg.chromePaths, entry) {
		return slices.Clone(cfg.chromePaths), fmt.Errorf("deleting chrome path %s: %w", path, errChromeNotFound)
	}
	next := slices.DeleteFunc(slices.Clone(cfg.chromePaths), func(p chrome.PathConfig) bool { return p == entry })
	if err := cfg.writeChromePaths(next); err != nil {
		return slices.Clone(cfg.chromePaths), err
	}
	return slices.Clone(cfg.chromePaths), nil
}

// GetChromeProfiles returns the Chrome profiles besides the default one.
func (a *App) GetChromeProfiles() ([]string, error) {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return slices.Clone(a.Config.chromeProfiles), nil
}

// AddChromeProfile adds a Chrome profile and returns the profiles. Chrome
// creates its user-data directory on first start.
func (a *App) AddChromeProfile(name string) ([]string, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	profile, err := validProfileName(name)
	if err != nil {
		return slices.Clone(cfg.chromeProfiles), fmt.Errorf("adding %w", err)
	}
	if slices.Contains(cfg.chromeProfiles, profile) {
		return slices.Clone(cfg.chromeProfiles), fmt.Errorf("adding chrome profile %s: %w", profile, errChromeAlreadyExists)
	}
	if err := cfg.writeChromeProfiles(append(slices.Clone(cfg.chromeProfiles), profile)); err != nil {
		return slices.Clone(cfg.chromeProfiles), err
	}
	return slices.Clone(cfg.chromeProfiles), nil
}

// DeleteChromeProfile removes a Chrome profile and its user-data directory,
// and returns the profiles.
func (a *App) DeleteChromeProfile(name string) ([]string, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	profile, err := validProfileName(name)
	if err != nil {
		return slices.Clone(cfg.chromeProfiles), fmt.Errorf("deleting %w", err)
	}
	if !slices.Contains(cfg.chromeProfiles, profile) {
		return slices.Clone(cfg.chromeProfiles), fmt.Errorf("deleting chrome profile %s: %w", profile, errChromeNotFound)
	}
	if err := os.RemoveAll(filepath.Join(a.chromeConfigDir, "chrome_profiles", profile)); err != nil {
		return slices.Clone(cfg.chromeProfiles), fmt.Errorf("deleting chrome profile %s: %w", profile, err)
	}
	next := slices.DeleteFunc(slices.Clone(cfg.chromeProfiles), func(p string) bool { return p == profile })
	if err := cfg.writeChromeProfiles(next); err != nil {
		return slices.Clone(cfg.chromeProfiles), err
	}
	return slices.Clone(cfg.chromeProfiles), nil
}
