package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/tfkr-ae/marasi/chrome"
	"go.yaml.in/yaml/v3"
)

// The Chrome paths and profiles Start Chrome uses are this machine's, in
// Marasi's own config (marasi_config.yaml in Marasi's config directory),
// shared with the Marasi CLI and every service instance, whatever the
// connection: Chrome runs on this machine. Like Marasi's service.Chrome,
// every call takes marasi_config.lock, rereads the file and changes only
// chrome_dirs or chrome_profiles.
const (
	marasiConfigFile     = "marasi_config.yaml"
	marasiConfigLockFile = "marasi_config.lock"
	chromeDirsKey        = "chrome_dirs"
	chromeProfilesKey    = "chrome_profiles"
	// marasiConfigLockPoll and marasiConfigLockWait bound how the app waits
	// for another holder of marasi_config.lock.
	marasiConfigLockPoll = 10 * time.Millisecond
	marasiConfigLockWait = 10 * time.Second
)

var (
	errChromeNotFound      = errors.New("not found")
	errChromeAlreadyExists = errors.New("already exists")
	errChromeInvalid       = errors.New("invalid")
)

// chromePathEntry is a Chrome path as marasi_config.yaml stores it.
type chromePathEntry struct {
	OS   string `yaml:"os"`
	Path string `yaml:"path"`
}

// chromeSettings is the Chrome part of marasi_config.yaml.
type chromeSettings struct {
	paths    []chrome.PathConfig
	profiles []string
}

// validChromePath reports whether path names an executable for an OS the
// launcher knows.
func validChromePath(path chrome.PathConfig) bool {
	if path.Path == "" {
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

// withChromeSettings takes marasi_config.lock in Marasi's config directory,
// rereads marasi_config.yaml and hands its Chrome settings to change. When
// change returns a key, that key alone is written back with the settings'
// new value; every other key stays as it was. It returns the settings as
// they stand after the call.
func (a *App) withChromeSettings(change func(*chromeSettings) (string, error)) (settings chromeSettings, resultErr error) {
	settings = chromeSettings{paths: []chrome.PathConfig{}, profiles: []string{}}
	unlock, err := lockMarasiConfig(a.marasiConfigDir)
	if err != nil {
		return settings, err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()

	path := filepath.Join(a.marasiConfigDir, marasiConfigFile)
	doc, err := readConfigDocument(path)
	if err != nil {
		return settings, fmt.Errorf("reading %s: %w", path, err)
	}
	read, err := parseChromeSettings(doc)
	if err != nil {
		return settings, fmt.Errorf("reading %s: %w", path, err)
	}
	settings = read
	if change == nil {
		return settings, nil
	}
	next := chromeSettings{paths: slices.Clone(read.paths), profiles: slices.Clone(read.profiles)}
	key, err := change(&next)
	if err != nil || key == "" {
		return settings, err
	}
	var value any = next.profiles
	if key == chromeDirsKey {
		entries := make([]chromePathEntry, len(next.paths))
		for i, p := range next.paths {
			entries[i] = chromePathEntry{OS: p.OS, Path: p.Path}
		}
		value = entries
	}
	if err := writeConfigKeys(path, map[string]any{key: value}); err != nil {
		return settings, fmt.Errorf("saving %s: %w", key, err)
	}
	return next, nil
}

// parseChromeSettings reads chrome_dirs and chrome_profiles from a
// marasi_config.yaml document. A section Marasi couldn't read either is an
// error, so the app never writes over it.
func parseChromeSettings(doc *yaml.Node) (chromeSettings, error) {
	settings := chromeSettings{paths: []chrome.PathConfig{}, profiles: []string{}}
	if node := documentValue(doc, chromeDirsKey); node != nil {
		var entries []chromePathEntry
		if err := node.Decode(&entries); err != nil {
			return settings, fmt.Errorf("%s: %w", chromeDirsKey, err)
		}
		for _, entry := range entries {
			settings.paths = append(settings.paths, chrome.PathConfig{OS: entry.OS, Path: entry.Path})
		}
	}
	if node := documentValue(doc, chromeProfilesKey); node != nil {
		var names []string
		if err := node.Decode(&names); err != nil {
			return settings, fmt.Errorf("%s: %w", chromeProfilesKey, err)
		}
		settings.profiles = append(settings.profiles, names...)
	}
	return settings, nil
}

// lockMarasiConfig polls for an exclusive lock on marasi_config.lock in dir,
// the lock Marasi's CLI and service instances hold while they reread and
// write marasi_config.yaml.
func lockMarasiConfig(dir string) (unlock func() error, err error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("creating Marasi's config directory: %w", err)
	}
	path := filepath.Join(dir, marasiConfigLockFile)
	lock, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, fmt.Errorf("opening %s: %w", path, err)
	}
	deadline := time.Now().Add(marasiConfigLockWait)
	for {
		err := tryLockFile(lock)
		if err == nil {
			return func() error { return errors.Join(unlockFile(lock), lock.Close()) }, nil
		}
		if !lockUnavailable(err) {
			return nil, errors.Join(fmt.Errorf("locking %s: %w", path, err), lock.Close())
		}
		if !time.Now().Before(deadline) {
			return nil, errors.Join(fmt.Errorf("locking %s: another Marasi process holds it", path), lock.Close())
		}
		time.Sleep(marasiConfigLockPoll)
	}
}

// GetChromePaths returns the Chrome executables Start Chrome tries first.
func (a *App) GetChromePaths() ([]chrome.PathConfig, error) {
	settings, err := a.withChromeSettings(nil)
	return settings.paths, err
}

// AddChromePath adds a Chrome executable for os and returns the paths.
func (a *App) AddChromePath(path, os string) ([]chrome.PathConfig, error) {
	entry := chrome.PathConfig{OS: os, Path: strings.TrimSpace(path)}
	settings, err := a.withChromeSettings(func(s *chromeSettings) (string, error) {
		switch {
		case !validChromePath(entry):
			return "", fmt.Errorf("adding chrome path: %w path or OS", errChromeInvalid)
		case slices.Contains(s.paths, entry):
			return "", fmt.Errorf("adding chrome path %s: %w", entry.Path, errChromeAlreadyExists)
		}
		s.paths = append(s.paths, entry)
		return chromeDirsKey, nil
	})
	return settings.paths, err
}

// DeleteChromePath removes a Chrome executable and returns the paths.
func (a *App) DeleteChromePath(path, os string) ([]chrome.PathConfig, error) {
	entry := chrome.PathConfig{OS: os, Path: path}
	settings, err := a.withChromeSettings(func(s *chromeSettings) (string, error) {
		if !slices.Contains(s.paths, entry) {
			return "", fmt.Errorf("deleting chrome path %s: %w", path, errChromeNotFound)
		}
		s.paths = slices.DeleteFunc(s.paths, func(p chrome.PathConfig) bool { return p == entry })
		return chromeDirsKey, nil
	})
	return settings.paths, err
}

// GetChromeProfiles returns the Chrome profiles besides the default one.
func (a *App) GetChromeProfiles() ([]string, error) {
	settings, err := a.withChromeSettings(nil)
	return settings.profiles, err
}

// AddChromeProfile adds a Chrome profile and returns the profiles. Chrome
// creates its user-data directory on first start.
func (a *App) AddChromeProfile(name string) ([]string, error) {
	settings, err := a.withChromeSettings(func(s *chromeSettings) (string, error) {
		profile, err := validProfileName(name)
		if err != nil {
			return "", fmt.Errorf("adding %w", err)
		}
		if slices.Contains(s.profiles, profile) {
			return "", fmt.Errorf("adding chrome profile %s: %w", profile, errChromeAlreadyExists)
		}
		s.profiles = append(s.profiles, profile)
		return chromeProfilesKey, nil
	})
	return settings.profiles, err
}

// DeleteChromeProfile removes a Chrome profile and its user-data directory
// under chrome_profiles in Marasi's config directory, and returns the
// profiles.
func (a *App) DeleteChromeProfile(name string) ([]string, error) {
	settings, err := a.withChromeSettings(func(s *chromeSettings) (string, error) {
		profile, err := validProfileName(name)
		if err != nil {
			return "", fmt.Errorf("deleting %w", err)
		}
		if !slices.Contains(s.profiles, profile) {
			return "", fmt.Errorf("deleting chrome profile %s: %w", profile, errChromeNotFound)
		}
		if err := os.RemoveAll(filepath.Join(a.marasiConfigDir, "chrome_profiles", profile)); err != nil {
			return "", fmt.Errorf("deleting chrome profile %s: %w", profile, err)
		}
		s.profiles = slices.DeleteFunc(s.profiles, func(p string) bool { return p == profile })
		return chromeProfilesKey, nil
	})
	return settings.profiles, err
}
