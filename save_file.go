package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

// writeSavedFile writes what SaveFileAs saves. Tests replace it.
var writeSavedFile = func(path string, data []byte) error {
	return os.WriteFile(path, data, 0600)
}

// SaveFileAs asks where to save bytes the frontend fetched from the service
// (contentBase64, standard base64) and writes them there. The dialog
// suggests defaultName in Downloads and offers filterName (filterPattern,
// such as "*.crt"; none when empty) and All Files. It returns the saved
// path, or "" when the user cancelled.
func (a *App) SaveFileAs(title, defaultName, filterName, filterPattern, contentBase64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(contentBase64)
	if err != nil {
		return "", fmt.Errorf("saving %s: the content is not base64: %w", defaultName, err)
	}
	var filters []fileFilter
	if filterPattern != "" {
		filters = append(filters, fileFilter{DisplayName: filterName, Pattern: filterPattern})
	}
	filters = append(filters, fileFilter{DisplayName: "All Files (*.*)", Pattern: "*.*"})
	home, _ := os.UserHomeDir()
	path, err := a.saveFileDialog(saveDialogOptions{
		DefaultDirectory: filepath.Join(home, "Downloads"),
		DefaultFilename:  defaultName,
		Title:            title,
		Filters:          filters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := writeSavedFile(path, data); err != nil {
		return "", fmt.Errorf("saving %s: %w", path, err)
	}
	return path, nil
}
