package main

import (
	"bytes"
	"fmt"

	"go.yaml.in/yaml/v3"
)

// Keybinding profiles persisted in the `keybindings` section of
// marasi_appconfig.yaml. See ADR 0001: a profile stores overrides of the
// immutable factory defaults per platform variant; a missing override
// inherits, an empty key list is intentionally unbound.

const (
	keybindingsKey     = "keybindings"
	keybindingsVersion = 1

	platformMacOS        = "macos"
	platformWindowsLinux = "windows-linux"
)

var keybindingPlatforms = []string{platformMacOS, platformWindowsLinux}

// KeybindingOverride is one action's complete binding list in a platform
// variant. Action ids are values, not map keys, because Viper lowercases keys.
type KeybindingOverride struct {
	Action string   `json:"action" yaml:"action"`
	Keys   []string `json:"keys" yaml:"keys"`
}

// KeybindingProfile is a named set of overrides with a stable identity.
// Overrides is keyed by platform variant: "macos" and "windows-linux".
// KnownActions lists the catalog action ids the profile was last saved
// against; an action missing from it is new to the profile, and its factory
// defaults inherit only when they do not collide with a customization.
type KeybindingProfile struct {
	ID           string                          `json:"id" yaml:"id"`
	Name         string                          `json:"name" yaml:"name"`
	Overrides    map[string][]KeybindingOverride `json:"overrides" yaml:"overrides"`
	KnownActions []string                        `json:"knownActions" yaml:"known_actions"`
}

// KeybindingConfig is the persisted keybindings section.
type KeybindingConfig struct {
	Version       int                 `json:"version" yaml:"version"`
	ActiveProfile string              `json:"activeProfile" yaml:"active_profile"`
	Profiles      []KeybindingProfile `json:"profiles" yaml:"profiles"`
}

// KeybindingState is what the frontend reads. When Problem is set, the saved
// section is invalid or from an unsupported version: it is left untouched on
// disk and Config holds the in-memory factory profile.
type KeybindingState struct {
	Config  KeybindingConfig `json:"config"`
	Problem string           `json:"problem"`
}

func factoryKeybindings() KeybindingConfig {
	return KeybindingConfig{
		Version:       keybindingsVersion,
		ActiveProfile: "default",
		Profiles: []KeybindingProfile{{
			ID:           "default",
			Name:         "Default",
			Overrides:    map[string][]KeybindingOverride{platformMacOS: {}, platformWindowsLinux: {}},
			KnownActions: []string{},
		}},
	}
}

// parseKeybindings decodes the raw section strictly: unknown fields and
// wrong types are errors rather than silently dropped data.
func parseKeybindings(node *yaml.Node) (KeybindingConfig, error) {
	var config KeybindingConfig
	if node == nil {
		return config, fmt.Errorf("keybindings section is missing")
	}
	// Check the version first: a future format may add fields this version
	// does not know, which is "unsupported", not "invalid".
	var versioned struct {
		Version int `yaml:"version"`
	}
	if err := node.Decode(&versioned); err == nil && versioned.Version > keybindingsVersion {
		return config, fmt.Errorf("keybindings version %d is not supported (this Marasi reads version %d)", versioned.Version, keybindingsVersion)
	}
	raw, err := yaml.Marshal(node)
	if err != nil {
		return config, fmt.Errorf("reading keybindings section: %w", err)
	}
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	decoder.KnownFields(true)
	if err := decoder.Decode(&config); err != nil {
		return KeybindingConfig{}, fmt.Errorf("invalid keybindings section: %w", err)
	}
	if err := checkKeybindingStructure(config); err != nil {
		return KeybindingConfig{}, err
	}
	return config, nil
}

// GetKeybindings returns the saved keybinding profiles, or the factory
// profile plus the problem when the saved section cannot be used.
func (a *App) GetKeybindings() KeybindingState {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return KeybindingState{Config: a.Config.keybindings, Problem: a.Config.keybindingsProblem}
}

// KeybindingAction describes one catalog action for validation. The catalog
// is defined in the frontend (it includes actions derived from extensions),
// so the frontend sends it with every save; see notes/persistence.md.
type KeybindingAction struct {
	ID       string              `json:"id"`
	Context  string              `json:"context"`
	Defaults map[string][]string `json:"defaults"`
}

// SaveKeybindings validates the complete keybindings section against the
// catalog, writes it atomically, and only then makes it the live config. On
// any error the file and the in-memory config are unchanged.
func (a *App) SaveKeybindings(config KeybindingConfig, catalog []KeybindingAction) (KeybindingState, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	current := KeybindingState{Config: cfg.keybindings, Problem: cfg.keybindingsProblem}
	if err := validateKeybindings(config, catalog); err != nil {
		return current, fmt.Errorf("invalid keybindings: %w", err)
	}
	config = settleKeybindings(config, catalog)
	if err := writeConfigKeys(cfg.path(), map[string]any{keybindingsKey: config}); err != nil {
		return current, fmt.Errorf("saving keybindings: %w", err)
	}
	cfg.keybindings = config
	cfg.keybindingsProblem = ""
	return KeybindingState{Config: cfg.keybindings}, nil
}
