package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Profile files go through the native file dialogs, which tests and the
// headless verification cannot drive; MARASI_KEYBINDINGS_PROFILE_FILE
// stands in for the path the user would pick.
func TestAppKeybindingProfileFiles(t *testing.T) {
	const contents = "{\n  \"format\": \"marasi-keybinding-profile\",\n  \"version\": 1\n}\n"

	t.Run("should write an exported profile to the chosen file and read it back for import", func(t *testing.T) {
		dir := t.TempDir()
		app := loadConfigApp(t, dir)
		configBefore, err := os.ReadFile(appConfigPath(dir))
		if err != nil {
			t.Fatalf("reading app config: %v", err)
		}
		path := filepath.Join(t.TempDir(), "work.marasi-keys.json")
		t.Setenv(keybindingProfileFileEnv, path)

		saved, err := app.ExportKeybindingProfile("work.marasi-keys.json", contents)
		if err != nil {
			t.Fatalf("exporting: %v", err)
		}
		if saved != path {
			t.Fatalf("wanted: %q\ngot: %q", path, saved)
		}
		written, err := os.ReadFile(path)
		if err != nil || string(written) != contents {
			t.Fatalf("wanted file contents %q\ngot: %q (%v)", contents, written, err)
		}

		file, err := app.ImportKeybindingProfile()
		if err != nil {
			t.Fatalf("importing: %v", err)
		}
		if file.Path != path || file.Contents != contents {
			t.Fatalf("wanted: %q %q\ngot: %+v", path, contents, file)
		}
		configAfter, _ := os.ReadFile(appConfigPath(dir))
		if string(configAfter) != string(configBefore) {
			t.Fatalf("wanted: app config untouched by export and import\ngot:\n%s", configAfter)
		}
	})

	t.Run("should replace an existing file on export", func(t *testing.T) {
		app := loadConfigApp(t, t.TempDir())
		path := filepath.Join(t.TempDir(), "old.json")
		if err := os.WriteFile(path, []byte("a much longer previous file that must not leave a tail"), 0600); err != nil {
			t.Fatal(err)
		}
		t.Setenv(keybindingProfileFileEnv, path)

		if _, err := app.ExportKeybindingProfile("old.json", contents); err != nil {
			t.Fatalf("exporting: %v", err)
		}
		if written, _ := os.ReadFile(path); string(written) != contents {
			t.Fatalf("wanted: %q\ngot: %q", contents, written)
		}
	})

	t.Run("should refuse to import a file larger than a profile can be", func(t *testing.T) {
		app := loadConfigApp(t, t.TempDir())
		path := filepath.Join(t.TempDir(), "huge.json")
		if err := os.WriteFile(path, []byte(strings.Repeat(" ", maxKeybindingProfileFileSize+1)), 0600); err != nil {
			t.Fatal(err)
		}
		t.Setenv(keybindingProfileFileEnv, path)

		file, err := app.ImportKeybindingProfile()
		if err == nil || !strings.Contains(err.Error(), "too large") {
			t.Fatalf("wanted: too large error\ngot: %+v, %v", file, err)
		}
		if file.Contents != "" {
			t.Fatalf("wanted: no contents\ngot: %d bytes", len(file.Contents))
		}
	})

	t.Run("should report a file that cannot be read", func(t *testing.T) {
		app := loadConfigApp(t, t.TempDir())
		t.Setenv(keybindingProfileFileEnv, filepath.Join(t.TempDir(), "missing.json"))

		if _, err := app.ImportKeybindingProfile(); err == nil {
			t.Fatal("wanted: an error for a missing file")
		}
	})

	t.Run("should save an imported profile's menu letters, and refuse a bad one with the frontend's explanation", func(t *testing.T) {
		// The profile part of a file portable.js exports, which the frontend
		// imports and then saves with SaveKeybindings.
		file := func(letter string) string {
			return `{"format": "marasi-keybinding-profile", "version": 1, "profile": {"name": "Work", "overrides": {"macos": [], "windows-linux": []},
				"knownActions": [], "letters": [{"group": "global.go", "letter": "` + letter + `"}]}}`
		}
		importAndSave := func(t *testing.T, app *App, contents string) (KeybindingState, error) {
			t.Helper()
			path := filepath.Join(t.TempDir(), "work.marasi-keys.json")
			if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv(keybindingProfileFileEnv, path)
			imported, err := app.ImportKeybindingProfile()
			if err != nil {
				t.Fatalf("importing: %v", err)
			}
			var parsed struct{ Profile KeybindingProfile }
			if err := json.Unmarshal([]byte(imported.Contents), &parsed); err != nil {
				t.Fatalf("parsing the file: %v", err)
			}
			config := knownKeybindings()
			parsed.Profile.ID = "work"
			config.Profiles = append(config.Profiles, parsed.Profile)
			return app.SaveKeybindings(config, letterKeybindingCatalog())
		}

		dir := t.TempDir()
		saved, err := importAndSave(t, loadConfigApp(t, dir), file("X"))
		if err != nil {
			t.Fatalf("saving the imported profile: %v", err)
		}
		want := []KeybindingLetter{{Group: "global.go", Letter: "X"}}
		if got := saved.Config.Profiles[1].Letters; !reflect.DeepEqual(got, want) {
			t.Fatalf("wanted: %+v\ngot: %+v", want, got)
		}
		if got := loadConfigApp(t, dir).GetKeybindings().Config.Profiles[1].Letters; !reflect.DeepEqual(got, want) {
			t.Fatalf("wanted after restart: %+v\ngot: %+v", want, got)
		}

		// portable.test.js refuses the same file with "Go to (global) and
		// Project (global) both use menu letter P".
		_, err = importAndSave(t, loadConfigApp(t, t.TempDir()), file("P"))
		if err == nil || !strings.Contains(err.Error(), `profile "Work": Go to (global) and Project (global) both use menu letter P`) {
			t.Fatalf("wanted the clash refused\ngot: %v", err)
		}
		_, err = importAndSave(t, loadConfigApp(t, t.TempDir()), file("Q"))
		if err == nil || !strings.Contains(err.Error(), "menu letter Q is reserved; K, Q and H are never menu letters") {
			t.Fatalf("wanted the reserved letter refused\ngot: %v", err)
		}
	})
}
