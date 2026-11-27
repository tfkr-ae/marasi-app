package main

import (
	"os"
	"reflect"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

func railOrderKeyPresent(t *testing.T, dir string) (any, bool) {
	t.Helper()
	data, err := os.ReadFile(appConfigPath(dir))
	if err != nil {
		t.Fatalf("reading app config: %v", err)
	}
	var parsed map[string]any
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parsing app config: %v", err)
	}
	val, ok := parsed["rail_order"]
	return val, ok
}

func TestAppRailOrder(t *testing.T) {
	t.Run("fresh config omits rail_order and returns an empty list", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)

		got := app.GetRailOrder()
		if got == nil || len(got) != 0 {
			t.Fatalf("wanted: empty non-nil slice\ngot: %#v", got)
		}
		if val, ok := railOrderKeyPresent(t, dir); ok {
			t.Fatalf("wanted: rail_order omitted from fresh config\ngot: %#v", val)
		}
	})

	t.Run("saving a custom order persists across reload without disturbing other keys", func(t *testing.T) {
		dir := t.TempDir()
		writeAppConfig(t, dir, "vim_enabled: false\nkeybindings:\n  broken: [not, valid, schema]\n")
		app := loadConfigApp(t, dir)
		want := []string{"launchpad", "ledger", "cyberchef"}

		saved, err := app.SaveRailOrder(want)
		if err != nil {
			t.Fatalf("saving: %v", err)
		}
		if !reflect.DeepEqual(saved, want) {
			t.Fatalf("wanted: %v\ngot: %v", want, saved)
		}
		if got := loadConfigApp(t, dir).GetRailOrder(); !reflect.DeepEqual(got, want) {
			t.Fatalf("after reload wanted: %v\ngot: %v", want, got)
		}
		raw := readAppConfig(t, dir)
		if !strings.Contains(raw, "vim_enabled: false") {
			t.Fatalf("wanted: vim_enabled preserved\ngot:\n%s", raw)
		}
		if kb := keybindingsSection(t, raw); kb == nil {
			t.Fatalf("wanted: preserved invalid keybindings section\ngot:\n%s", raw)
		}
	})

	t.Run("saving trims, lowercases, and deduplicates preserving first occurrence", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)

		saved, err := app.SaveRailOrder([]string{"  Ledger ", "CYBERCHEF", "ledger", "Interact", "cyberchef"})
		if err != nil {
			t.Fatalf("saving: %v", err)
		}
		want := []string{"ledger", "cyberchef", "interact"}
		if !reflect.DeepEqual(saved, want) {
			t.Fatalf("wanted: %v\ngot: %v", want, saved)
		}
		if got := loadConfigApp(t, dir).GetRailOrder(); !reflect.DeepEqual(got, want) {
			t.Fatalf("after reload wanted: %v\ngot: %v", want, got)
		}
	})

	t.Run("resetting deletes rail_order atomically without disturbing other sections", func(t *testing.T) {
		dir := t.TempDir()
		writeAppConfig(t, dir, "vim_enabled: false\nkeybindings:\n  broken: [keep, me]\n")
		app := loadConfigApp(t, dir)
		if _, err := app.SaveRailOrder([]string{"cyberchef", "ledger"}); err != nil {
			t.Fatalf("saving: %v", err)
		}

		got, err := app.ResetRailOrder()
		if err != nil {
			t.Fatalf("resetting: %v", err)
		}
		if got == nil || len(got) != 0 {
			t.Fatalf("wanted: empty non-nil slice\ngot: %#v", got)
		}
		if val, ok := railOrderKeyPresent(t, dir); ok {
			t.Fatalf("wanted: rail_order deleted from YAML\ngot: %#v", val)
		}
		if reloaded := loadConfigApp(t, dir).GetRailOrder(); reloaded == nil || len(reloaded) != 0 {
			t.Fatalf("after reload wanted: empty slice\ngot: %#v", reloaded)
		}
		raw := readAppConfig(t, dir)
		if !strings.Contains(raw, "vim_enabled: false") {
			t.Fatalf("wanted: vim_enabled preserved\ngot:\n%s", raw)
		}
		if kb := keybindingsSection(t, raw); kb == nil {
			t.Fatalf("wanted: invalid keybindings preserved\ngot:\n%s", raw)
		}
	})

	t.Run("saving an empty slice deletes rail_order from YAML", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)
		if _, err := app.SaveRailOrder([]string{"interact", "ledger"}); err != nil {
			t.Fatalf("saving: %v", err)
		}

		got, err := app.SaveRailOrder([]string{})
		if err != nil {
			t.Fatalf("saving empty: %v", err)
		}
		if got == nil || len(got) != 0 {
			t.Fatalf("wanted: empty non-nil slice\ngot: %#v", got)
		}
		if val, ok := railOrderKeyPresent(t, dir); ok {
			t.Fatalf("wanted: rail_order deleted from YAML\ngot: %#v", val)
		}
	})

	t.Run("invalid blank inputs are rejected and leave disk and memory unchanged", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)
		initial := []string{"launchpad", "ledger"}
		if _, err := app.SaveRailOrder(initial); err != nil {
			t.Fatalf("saving initial: %v", err)
		}
		before := readAppConfig(t, dir)

		cases := map[string][]string{
			"empty string":      {"ledger", ""},
			"whitespace string": {"ledger", "   \t  "},
		}
		for name, input := range cases {
			t.Run(name, func(t *testing.T) {
				got, err := app.SaveRailOrder(input)
				if err == nil {
					t.Fatalf("wanted error, got %v", got)
				}
				if !reflect.DeepEqual(got, initial) {
					t.Fatalf("wanted returned current order %v, got %v", initial, got)
				}
				if !reflect.DeepEqual(app.GetRailOrder(), initial) {
					t.Fatalf("wanted memory unchanged %v, got %v", initial, app.GetRailOrder())
				}
				if after := readAppConfig(t, dir); after != before {
					t.Fatalf("wanted file unchanged\nbefore:\n%s\nafter:\n%s", before, after)
				}
			})
		}
	})

	t.Run("malformed rail_order on disk falls back to empty and leaves file untouched", func(t *testing.T) {
		cases := map[string]string{
			"scalar string":   "rail_order: ledger\n",
			"mapping":         "rail_order:\n  first: ledger\n",
			"null value":      "rail_order: null\n",
			"non-string item": "rail_order:\n  - ledger\n  - 42\n",
			"blank item":      "rail_order:\n  - ledger\n  - \"   \"\n",
		}
		for name, section := range cases {
			t.Run(name, func(t *testing.T) {
				dir := t.TempDir()
				app := loadConfigApp(t, dir)
				_ = app
				base := readAppConfig(t, dir)
				content := base + section
				writeAppConfig(t, dir, content)

				reloaded := loadConfigApp(t, dir)
				if got := reloaded.GetRailOrder(); got == nil || len(got) != 0 {
					t.Fatalf("wanted: empty slice fallback\ngot: %#v", got)
				}
				if after := readAppConfig(t, dir); after != content {
					t.Fatalf("wanted: file untouched\nbefore:\n%s\nafter:\n%s", content, after)
				}
			})
		}
	})
}
