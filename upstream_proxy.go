package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/service"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// upstreamProxyCAFileEnv, when set, is used as the chosen CA file instead of
// showing the native open dialog, which tests and the headless verification
// (verify-marasi) cannot drive.
const upstreamProxyCAFileEnv = "MARASI_UPSTREAM_PROXY_CA_FILE"

// maxUpstreamProxyCAFileSize bounds what a CA read takes. A PEM bundle of a
// few hundred certificates fits.
const maxUpstreamProxyCAFileSize = 1 << 20

var upstreamProxyCAFilters = []runtime.FileFilter{
	{DisplayName: "Certificates (*.pem, *.crt, *.cer)", Pattern: "*.pem;*.crt;*.cer"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

// errNoUpstreamProxyChange reports an update that names nothing to change.
var errNoUpstreamProxyChange = errors.New("upstream proxy update: nothing to change")

// UpstreamProxyState is Settings → Upstream Proxy: this machine's upstream
// proxy list, redacted, and the open project's selection. Selected is ""
// for a direct connection, and Configured is false when this machine does
// not list it, so the project's traffic fails closed.
type UpstreamProxyState struct {
	Items      []service.UpstreamProxy `json:"items"`
	Selected   string                  `json:"selected"`
	Configured bool                    `json:"configured"`
}

// GetUpstreamProxies reads the list again, so entries another instance
// edited show.
func (a *App) GetUpstreamProxies() (UpstreamProxyState, error) {
	items, err := a.upstreamProxies.List(context.Background())
	if err != nil {
		return UpstreamProxyState{}, err
	}
	return a.upstreamProxyState(items), nil
}

// AddUpstreamProxy adds an entry to this machine's list. ca is a PEM
// bundle, "" for none.
func (a *App) AddUpstreamProxy(name, url, ca string) (UpstreamProxyState, error) {
	items, err := a.upstreamProxies.Add(context.Background(), marasi.UpstreamProxyConfig{Name: name, URL: url, CA: ca})
	if err != nil {
		return UpstreamProxyState{}, err
	}
	return a.upstreamProxyState(items), nil
}

// UpdateUpstreamProxy changes the named entry. An empty url or ca leaves it
// as it is, and removeCA drops the CA.
func (a *App) UpdateUpstreamProxy(name, url, ca string, removeCA bool) (UpstreamProxyState, error) {
	var update marasi.UpstreamProxyUpdate
	if url != "" {
		update.URL = &url
	}
	if removeCA {
		ca = ""
		update.CA = &ca
	} else if ca != "" {
		update.CA = &ca
	}
	if update.URL == nil && update.CA == nil {
		return UpstreamProxyState{}, errNoUpstreamProxyChange
	}
	items, err := a.upstreamProxies.Update(context.Background(), name, update)
	if err != nil {
		return UpstreamProxyState{}, err
	}
	return a.upstreamProxyState(items), nil
}

// RemoveUpstreamProxy removes the named entry. A project that selected it
// keeps the selection, and its traffic fails closed.
func (a *App) RemoveUpstreamProxy(name string) (UpstreamProxyState, error) {
	items, err := a.upstreamProxies.Remove(context.Background(), name)
	if err != nil {
		return UpstreamProxyState{}, err
	}
	return a.upstreamProxyState(items), nil
}

// UseUpstreamProxy selects the open project's upstream proxy, or a direct
// connection for "". New connections follow it at once.
func (a *App) UseUpstreamProxy(name string) (UpstreamProxyState, error) {
	if err := a.upstreamProxies.Use(context.Background(), name); err != nil {
		return UpstreamProxyState{}, err
	}
	return a.GetUpstreamProxies()
}

// CheckUpstreamProxy makes one test connection to target through the named
// entry, selected or not.
func (a *App) CheckUpstreamProxy(name, target string) (service.UpstreamProxyCheck, error) {
	return a.upstreamProxies.Check(context.Background(), name, target)
}

func (a *App) upstreamProxyState(items []service.UpstreamProxy) UpstreamProxyState {
	selection := a.upstreamProxies.Selection()
	return UpstreamProxyState{Items: items, Selected: selection.Selected, Configured: selection.Configured}
}

// ReadUpstreamProxyCAFile asks for a CA file and returns its text unparsed;
// Marasi checks it when the entry is added or updated. It returns "" when
// the user cancelled.
func (a *App) ReadUpstreamProxyCAFile() (string, error) {
	path := os.Getenv(upstreamProxyCAFileEnv)
	if path == "" {
		var err error
		path, err = runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
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
