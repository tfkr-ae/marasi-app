package main

import (
	"encoding/json"
	"fmt"
	"mime"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Android has no save dialog (Wails' returns an error), so a Save As hands
// the file to the share sheet: Drive, Files, Gmail. The file goes in
// share/ under the app's files directory, which the FileProvider serves
// (build/android/.../xml/file_paths.xml). Android doesn't report whether
// the researcher picked a target, so the name comes back either way.
func init() { platformShareFile = shareFileAndroid }

func shareFileAndroid(name string, data []byte) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("sharing %s: %w", name, err)
	}
	dir := filepath.Join(home, "share")
	// Only the latest shared file is kept: the share sheet reads it once.
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("sharing %s: %w", name, err)
	}
	base := filepath.Base(name)
	path := filepath.Join(dir, base)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", fmt.Errorf("sharing %s: %w", name, err)
	}
	kind := mime.TypeByExtension(filepath.Ext(base))
	if kind == "" {
		kind = "application/octet-stream"
	}
	payload, _ := json.Marshal(map[string]string{"file": path, "mime": kind, "name": base})
	application.Android.Share(string(payload))
	return base, nil
}
