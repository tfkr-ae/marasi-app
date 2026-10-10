package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Keybinding profile files (docs/keybinding-profile-format.md). The
// frontend owns the format: it serializes the export and parses and
// validates an import against the catalog. The backend only chooses the file
// with a native dialog and moves the text. Neither call touches the app
// config; an imported profile is saved later with SaveKeybindings.

// keybindingProfileFileEnv, when set, is used as the chosen file instead of
// showing the native open or save dialog. Native dialogs cannot be driven by
// tests or by the headless verification (verify-marasi), which set it.
const keybindingProfileFileEnv = "MARASI_KEYBINDINGS_PROFILE_FILE"

// maxKeybindingProfileFileSize bounds what an import reads. A profile with
// every action overridden on both platforms is a few tens of KiB.
const maxKeybindingProfileFileSize = 1 << 20

var keybindingProfileFilters = []runtime.FileFilter{
	{DisplayName: "Marasi Keybinding Profiles (*.json)", Pattern: "*.json"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

// KeybindingProfileFile is a profile file chosen for import. Path is ""
// when the user cancelled the dialog.
type KeybindingProfileFile struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
}

// ExportKeybindingProfile asks where to save a profile file, suggesting
// defaultName, and writes contents there. It returns the path written, or
// "" when the user cancelled.
func (a *App) ExportKeybindingProfile(defaultName string, contents string) (string, error) {
	path := os.Getenv(keybindingProfileFileEnv)
	if path == "" {
		home, _ := os.UserHomeDir()
		var err error
		path, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			DefaultDirectory: filepath.Join(home, "Downloads"),
			DefaultFilename:  filepath.Base(defaultName),
			Title:            "Export Keybinding Profile",
			Filters:          keybindingProfileFilters,
		})
		if err != nil || path == "" {
			return "", err
		}
	}
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		return "", fmt.Errorf("writing %s: %w", path, err)
	}
	return path, nil
}

// ImportKeybindingProfile asks for a profile file and returns its text
// unparsed. Path is "" when the user cancelled.
func (a *App) ImportKeybindingProfile() (KeybindingProfileFile, error) {
	path := os.Getenv(keybindingProfileFileEnv)
	if path == "" {
		var err error
		path, err = runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
			Title:   "Import Keybinding Profile",
			Filters: keybindingProfileFilters,
		})
		if err != nil || path == "" {
			return KeybindingProfileFile{}, err
		}
	}
	file, err := os.Open(path)
	if err != nil {
		return KeybindingProfileFile{}, fmt.Errorf("reading %s: %w", path, err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxKeybindingProfileFileSize+1))
	if err != nil {
		return KeybindingProfileFile{}, fmt.Errorf("reading %s: %w", path, err)
	}
	if len(data) > maxKeybindingProfileFileSize {
		return KeybindingProfileFile{}, fmt.Errorf("%s is too large for a keybinding profile (over 1 MiB)", filepath.Base(path))
	}
	return KeybindingProfileFile{Path: path, Contents: string(data)}, nil
}
