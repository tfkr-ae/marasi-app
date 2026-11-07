package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// upstreamProxyCAFileEnv, when set, is used as the chosen CA file instead of
// showing the native open dialog, which tests and the headless verification
// (verify-marasi) cannot drive.
const upstreamProxyCAFileEnv = "MARASI_UPSTREAM_PROXY_CA_FILE"

// maxUpstreamProxyCAFileSize bounds what a CA read takes. A PEM bundle of a
// few hundred certificates fits.
const maxUpstreamProxyCAFileSize = 1 << 20

var upstreamProxyCAFilters = []fileFilter{
	{DisplayName: "Certificates (*.pem, *.crt, *.cer)", Pattern: "*.pem;*.crt;*.cer"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

// ReadUpstreamProxyCAFile asks for a CA file and returns its text unparsed;
// Marasi checks it when the entry is added or updated. It returns "" when
// the user cancelled.
func (a *App) ReadUpstreamProxyCAFile() (string, error) {
	path := os.Getenv(upstreamProxyCAFileEnv)
	if path == "" {
		var err error
		path, err = a.openFileDialog(openDialogOptions{
			Title:   "Choose a CA Certificate",
			Filters: upstreamProxyCAFilters,
		})
		if err != nil || path == "" {
			return "", err
		}
	}
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", path, err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxUpstreamProxyCAFileSize+1))
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", path, err)
	}
	if len(data) > maxUpstreamProxyCAFileSize {
		return "", fmt.Errorf("%s is too large for a CA certificate (over 1 MiB)", filepath.Base(path))
	}
	return string(data), nil
}
