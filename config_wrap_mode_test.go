package main

import "testing"

func TestWrapMode(t *testing.T) {
	t.Run("should default to auto when upgrading a config without it", func(t *testing.T) {
		dir := t.TempDir()
		writeAppConfig(t, dir, "first_run: false\nsyntax_mode: enabled\nvim_enabled: false\n")

		app := loadConfigApp(t, dir)

		if got := app.GetMarasiConfig().WrapMode; got != "auto" {
			t.Fatalf("wanted: auto\ngot: %q", got)
		}
	})

	t.Run("should keep a set mode across restarts", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)

		cfg, err := app.SetFlag("wrap_mode", "enabled")
		if err != nil {
			t.Fatalf("setting wrap_mode: %v", err)
		}
		if cfg.WrapMode != "enabled" {
			t.Fatalf("wanted: enabled\ngot: %q", cfg.WrapMode)
		}

		if got := loadConfigApp(t, dir).GetMarasiConfig().WrapMode; got != "enabled" {
			t.Fatalf("wanted after restart: enabled\ngot: %q", got)
		}
	})
}
