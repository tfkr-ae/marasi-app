package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

// writeSavedFile writes the file SaveFileAs saves. Tests replace it.
var writeSavedFile = os.WriteFile

// replaceWriteSavedFile points writeSavedFile at write and returns a
// function that puts it back.
func replaceWriteSavedFile(write func(string, []byte, os.FileMode) error) func() {
	before := writeSavedFile
	writeSavedFile = write
	return func() { writeSavedFile = before }
}

// SaveFileAs asks where to save bytes the frontend read from the service
// (a report, an artifact, the CA certificate) through the native Save
// dialog, suggesting defaultName in Downloads and, when filterPattern is
// set, one filter. contentBase64 is the file, standard base64. It returns
// the saved path, or "" when the user cancelled.
func (a *App) SaveFileAs(title, defaultName, filterName, filterPattern, contentBase64 string) (string, error) {
	content, err := base64.StdEncoding.DecodeString(contentBase64)
	if err != nil {
		return "", fmt.Errorf("saving %s: the content is not base64: %w", defaultName, err)
	}
	options := saveDialogOptions{
		DefaultFilename: filepath.Base(defaultName),
		Title:           title,
	}
	if home, err := os.UserHomeDir(); err == nil {
		options.DefaultDirectory = filepath.Join(home, "Downloads")
	}
	if filterPattern != "" {
		options.Filters = []fileFilter{{DisplayName: filterName, Pattern: filterPattern}}
	}
	path, err := a.saveFileDialog(options)
	if err != nil || path == "" {
		return "", err
	}
	if err := writeSavedFile(path, content, 0600); err != nil {
		return "", fmt.Errorf("saving %s: %w", path, err)
	}
	return path, nil
}
