package main

import "fmt"

// The Marasi CLI's app config keys. They are read from the document on
// demand rather than parsed into Config at load, so they stay apart from
// the other settings.
const (
	// cliPathKey is the CLI the researcher set or the app installed; ""
	// for none, which uses marasi on PATH.
	cliPathKey = "cli_path"
	// cliPathSourceKey says where cli_path came from: "custom" (set by the
	// researcher) or "installed" (installed by the app).
	cliPathSourceKey = "cli_path_source"
	// cliChannelKey is the CLI channel: "release" or "nightly", or ""
	// (absent) to follow the app's channel.
	cliChannelKey = "cli_channel"
)

// Where a CLI was found.
const (
	cliSourceCustom    = "custom"
	cliSourceInstalled = "installed"
	cliSourcePath      = "path"
)

// savedCLIPath is the CLI path in app config.
type savedCLIPath struct {
	Path   string
	Source string
}

// cliString reads a top-level string key; "" when absent or unreadable.
func (cfg *Config) cliString(key string) string {
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	doc, err := readConfigDocument(cfg.path())
	if err != nil {
		return ""
	}
	node := documentValue(doc, key)
	if node == nil {
		return ""
	}
	return node.Value
}

// cliPath is the saved CLI path, if any.
func (cfg *Config) cliPath() savedCLIPath {
	path := cfg.cliString(cliPathKey)
	if path == "" {
		return savedCLIPath{}
	}
	source := cfg.cliString(cliPathSourceKey)
	if source != cliSourceInstalled {
		source = cliSourceCustom
	}
	return savedCLIPath{Path: path, Source: source}
}

// setCLIPath saves the CLI path and where it came from; an empty path
// clears it.
func (cfg *Config) setCLIPath(saved savedCLIPath) error {
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	if err := writeConfigKeys(cfg.path(), map[string]any{cliPathKey: saved.Path, cliPathSourceKey: saved.Source}); err != nil {
		return fmt.Errorf("saving the Marasi CLI path: %w", err)
	}
	return nil
}

// cliChannelSetting is the saved CLI channel, "" to follow the app.
func (cfg *Config) cliChannelSetting() Channel {
	channel := Channel(cfg.cliString(cliChannelKey))
	if !channel.valid() {
		return ""
	}
	return channel
}

// setCLIChannel saves the CLI channel; "" follows the app.
func (cfg *Config) setCLIChannel(channel Channel) error {
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	if err := writeConfigKeys(cfg.path(), map[string]any{cliChannelKey: string(channel)}); err != nil {
		return fmt.Errorf("saving the CLI channel: %w", err)
	}
	return nil
}
