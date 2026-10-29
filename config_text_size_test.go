package main

import "testing"

func TestTextSize(t *testing.T) {
	t.Run("should default to default when upgrading a config without it", func(t *testing.T) {
		dir := t.TempDir()
		writeAppConfig(t, dir, "first_run: false\nsyntax_mode: enabled\nwrap_mode: auto\n")

		app := loadConfigApp(t, dir)

		if got := app.GetMarasiConfig().TextSize; got != "default" {
			t.Fatalf("wanted: default\ngot: %q", got)
		}
	})

	t.Run("should keep a set size across restarts", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)

		cfg, err := app.SetFlag("text_size", "large")
		if err != nil {
			t.Fatalf("setting text_size: %v", err)
		}
		if cfg.TextSize != "large" {
			t.Fatalf("wanted: large\ngot: %q", cfg.TextSize)
		}

		if got := loadConfigApp(t, dir).GetMarasiConfig().TextSize; got != "large" {
			t.Fatalf("wanted after restart: large\ngot: %q", got)
		}
	})
}
