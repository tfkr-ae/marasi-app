package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAppKeybindings(t *testing.T) {
	t.Run("should create an editable default profile when upgrading without a keybindings section", func(t *testing.T) {
		dir := t.TempDir()
		writeAppConfig(t, dir, "default_address: 10.0.0.1\ndefault_port: \"9090\"\nfirst_run: false\nsyntax_mode: dark\nvim_enabled: false\n")

		app := loadConfigApp(t, dir)

		state := app.GetKeybindings()
		if state.Problem != "" {
			t.Fatalf("wanted: no problem\ngot: %q", state.Problem)
		}
		want := KeybindingConfig{
			Version:       1,
			ActiveProfile: "default",
			Profiles: []KeybindingProfile{{
				ID:        "default",
				Name:      "Default",
				Overrides: map[string][]KeybindingOverride{"macos": {}, "windows-linux": {}},
			}},
		}
		if !reflect.DeepEqual(state.Config, want) {
			t.Fatalf("wanted: %+v\ngot: %+v", want, state.Config)
		}
		cfg := app.GetMarasiConfig()
		if cfg.DefaultAddress != "10.0.0.1" || cfg.DefaultPort != "9090" || cfg.FirstRun || cfg.VimEnabled || cfg.SyntaxMode != "dark" {
			t.Fatalf("wanted: unrelated preferences kept\ngot: %+v", cfg)
		}

		restarted := loadConfigApp(t, dir)
		if got := restarted.GetKeybindings(); !reflect.DeepEqual(got.Config, want) {
			t.Fatalf("wanted after restart: %+v\ngot: %+v", want, got.Config)
		}
		if got := restarted.GetMarasiConfig(); got.DefaultAddress != "10.0.0.1" || got.VimEnabled {
			t.Fatalf("wanted: unrelated preferences kept after restart\ngot: %+v", got)
		}
	})

	t.Run("should keep saved profiles, both variants, unbinding and dormant overrides across restarts and flag writes", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)
		want := KeybindingConfig{
			Version:       1,
			ActiveProfile: "vim-ish",
			Profiles: []KeybindingProfile{
				{ID: "default", Name: "Default", Overrides: map[string][]KeybindingOverride{"macos": {}, "windows-linux": {}}},
				{ID: "vim-ish", Name: "Vim-ish", Overrides: map[string][]KeybindingOverride{
					"macos": {
						{Action: "global.go-home", Keys: []string{"meta+h", "meta+shift+h"}},
						{Action: "global.go-ledger", Keys: []string{}},
						{Action: "extension.gone.do-thing", Keys: []string{"meta+alt+9"}},
					},
					"windows-linux": {
						{Action: "global.go-home", Keys: []string{"ctrl+h"}},
					},
				}},
			},
		}

		saved, err := app.SaveKeybindings(want, testKeybindingCatalog())
		if err != nil {
			t.Fatalf("saving keybindings: %v", err)
		}
		if !reflect.DeepEqual(saved.Config, want) {
			t.Fatalf("wanted: %+v\ngot: %+v", want, saved.Config)
		}
		if _, err := app.ToggleFlag("vim_enabled"); err != nil {
			t.Fatalf("toggling vim: %v", err)
		}
		if _, err := app.SetFlag("default_port", "9999"); err != nil {
			t.Fatalf("setting port: %v", err)
		}

		restarted := loadConfigApp(t, dir)
		got := restarted.GetKeybindings()
		if got.Problem != "" || !reflect.DeepEqual(got.Config, want) {
			t.Fatalf("wanted after restart: %+v\ngot: %+v (problem %q)", want, got.Config, got.Problem)
		}
		if cfg := restarted.GetMarasiConfig(); cfg.VimEnabled || cfg.DefaultPort != "9999" {
			t.Fatalf("wanted: flag writes kept\ngot: %+v", cfg)
		}
	})

	t.Run("should reject invalid updates and leave disk and live config unchanged", func(t *testing.T) {
		withOverrides := func(platform string, overrides ...KeybindingOverride) KeybindingConfig {
			config := factoryKeybindings()
			config.Profiles[0].Overrides[platform] = overrides
			return config
		}
		cases := map[string]KeybindingConfig{
			"menu opening unbound on macOS": withOverrides("macos",
				KeybindingOverride{Action: "global.open-menu", Keys: []string{}}),
			"menu opening shadowed by a page action on Windows/Linux": withOverrides("windows-linux",
				KeybindingOverride{Action: "ledger.drawer-open.close", Keys: []string{"ctrl+k"}}),
			"same-context duplicate with an inherited default": withOverrides("macos",
				KeybindingOverride{Action: "global.go-home", Keys: []string{"meta+2"}}),
			"same-context duplicate written in another notation": withOverrides("macos",
				KeybindingOverride{Action: "global.go-home", Keys: []string{"meta+j"}},
				KeybindingOverride{Action: "global.go-ledger", Keys: []string{"Meta+J"}}),
			"reserved dialog key (Escape)": withOverrides("macos",
				KeybindingOverride{Action: "global.go-home", Keys: []string{"escape"}}),
			"reserved dialog key (Shift+Tab)": withOverrides("windows-linux",
				KeybindingOverride{Action: "global.go-home", Keys: []string{"shift+tab"}}),
			"unknown platform variant": withOverrides("linux"),
			"unparseable binding": withOverrides("macos",
				KeybindingOverride{Action: "global.go-home", Keys: []string{"meta+"}}),
			"override without a key list": withOverrides("macos",
				KeybindingOverride{Action: "global.go-home"}),
			"unsupported version": func() KeybindingConfig {
				config := factoryKeybindings()
				config.Version = 2
				return config
			}(),
			"active profile that does not exist": func() KeybindingConfig {
				config := factoryKeybindings()
				config.ActiveProfile = "missing"
				return config
			}(),
			"duplicate profile names": func() KeybindingConfig {
				config := factoryKeybindings()
				config.Profiles = append(config.Profiles, KeybindingProfile{ID: "other", Name: " default ", Overrides: map[string][]KeybindingOverride{}})
				return config
			}(),
			"empty profile name": func() KeybindingConfig {
				config := factoryKeybindings()
				config.Profiles[0].Name = "  "
				return config
			}(),
		}
		for name, update := range cases {
			t.Run(name, func(t *testing.T) {
				dir := t.TempDir()
				app := loadConfigApp(t, dir)
				before := readAppConfig(t, dir)
				live := app.GetKeybindings()

				if _, err := app.SaveKeybindings(update, testKeybindingCatalog()); err == nil {
					t.Fatalf("wanted: an error\ngot: nil")
				}
				if after := readAppConfig(t, dir); after != before {
					t.Fatalf("wanted disk unchanged:\n%s\ngot:\n%s", before, after)
				}
				if got := app.GetKeybindings(); !reflect.DeepEqual(got, live) {
					t.Fatalf("wanted live config unchanged: %+v\ngot: %+v", live, got)
				}
			})
		}
	})

	t.Run("should allow reusing a binding in mutually exclusive contexts", func(t *testing.T) {
		app := loadConfigApp(t, t.TempDir())
		config := factoryKeybindings()
		config.Profiles[0].Overrides["macos"] = []KeybindingOverride{
			{Action: "ledger.drawer-closed.open-item", Keys: []string{"meta+j"}},
			{Action: "ledger.drawer-open.close", Keys: []string{"meta+j"}},
		}
		if _, err := app.SaveKeybindings(config, testKeybindingCatalog()); err != nil {
			t.Fatalf("wanted: saved\ngot: %v", err)
		}
	})

	t.Run("should leave disk and live config unchanged when the write fails", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)
		before := readAppConfig(t, dir)
		live := app.GetKeybindings()
		if err := os.Chmod(dir, 0500); err != nil {
			t.Fatalf("making config dir read-only: %v", err)
		}
		t.Cleanup(func() { os.Chmod(dir, 0700) })

		config := factoryKeybindings()
		config.Profiles[0].Overrides["macos"] = []KeybindingOverride{{Action: "global.go-home", Keys: []string{"meta+h"}}}
		if _, err := app.SaveKeybindings(config, testKeybindingCatalog()); err == nil {
			t.Fatalf("wanted: a write error\ngot: nil")
		}
		if after := readAppConfig(t, dir); after != before {
			t.Fatalf("wanted disk unchanged:\n%s\ngot:\n%s", before, after)
		}
		if got := app.GetKeybindings(); !reflect.DeepEqual(got, live) {
			t.Fatalf("wanted live config unchanged: %+v\ngot: %+v", live, got)
		}
		if _, err := app.ToggleFlag("vim_enabled"); err == nil {
			t.Fatalf("wanted: flag write error\ngot: nil")
		}
		if !app.GetMarasiConfig().VimEnabled {
			t.Fatalf("wanted: vim flag unchanged after failed write\ngot: toggled")
		}
	})
}

// testKeybindingCatalog describes a small catalog the way the frontend sends
// it: Ledger's drawer-open and drawer-closed contexts are mutually exclusive.
func testKeybindingCatalog() []KeybindingAction {
	both := func(mac, other string) map[string][]string {
		return map[string][]string{"macos": {mac}, "windows-linux": {other}}
	}
	return []KeybindingAction{
		{ID: "global.open-menu", Context: "global", Defaults: both("meta+k", "ctrl+k")},
		{ID: "global.go-home", Context: "global", Defaults: both("meta+1", "ctrl+1")},
		{ID: "global.go-ledger", Context: "global", Defaults: both("meta+2", "ctrl+2")},
		{ID: "ledger.drawer-closed.open-item", Context: "ledger.drawer-closed", Defaults: both("meta+e", "ctrl+e")},
		{ID: "ledger.drawer-open.close", Context: "ledger.drawer-open", Defaults: both("meta+e", "ctrl+e")},
	}
}

// loadConfigApp loads the app config in dir as a fresh app start would.
func loadConfigApp(t *testing.T, dir string) *App {
	t.Helper()
	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("loading config: %v", err)
	}
	return &App{Config: cfg}
}

func appConfigPath(dir string) string {
	return filepath.Join(dir, "marasi_appconfig.yaml")
}

func writeAppConfig(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(appConfigPath(dir), []byte(content), 0600); err != nil {
		t.Fatalf("writing app config: %v", err)
	}
}

func readAppConfig(t *testing.T, dir string) string {
	t.Helper()
	data, err := os.ReadFile(appConfigPath(dir))
	if err != nil {
		t.Fatalf("reading app config: %v", err)
	}
	return string(data)
}
