package main

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"slices"
	"strings"

	"github.com/tfkr-ae/marasi/chrome"
)

// Codes the frontend reads from a refused Start Chrome ("<what>: <code>: <cause>").
const (
	// listenerInactive: the connection's proxy listener is stopped.
	listenerInactive = "listener_inactive"
	// listenerLoopback: a remote connection's proxy listener binds that
	// host's loopback only, so Chrome on this machine can't reach it.
	listenerLoopback = "listener_loopback"
)

var (
	errListenerInactive = errors.New("the proxy listener is stopped")
	errListenerLoopback = errors.New("the remote proxy listener binds loopback only")
)

// ChromeStart is what Start Chrome needs from the frontend: the profile, the
// active connection, and what the frontend read through its service client,
// the proxy listener ("host:port" from GET /listener/status, "" when it is
// stopped) and the SPKI hash of GET /certificate.
type ChromeStart struct {
	Profile        string `json:"profile"`
	ConnectionKind string `json:"connectionKind"` // "local" or "remote"
	ConnectionURL  string `json:"connectionURL"`
	ProxyListener  string `json:"proxyListener"`
	SPKIHash       string `json:"spkiHash"`
}

// ChromeLaunch is one Chrome start, as the launcher takes it.
type ChromeLaunch struct {
	Address   string
	Port      string
	SPKIHash  string
	ConfigDir string
	Profile   string
	Paths     []chrome.PathConfig
}

// launchWithMarasi starts Chrome through the Marasi library's launcher. The
// app opens a window for the user, so it asks for no CDP endpoint.
func launchWithMarasi(launch ChromeLaunch) error {
	return chrome.NewLauncher(
		chrome.WithProxy(launch.Address, launch.Port),
		chrome.WithSPKIHash(launch.SPKIHash),
		chrome.WithConfigDir(launch.ConfigDir),
		chrome.WithProfile(launch.Profile),
		chrome.WithCustomPaths(launch.Paths),
	).Start()
}

// StartBrowser starts Chrome on this machine aimed at the connection's
// proxy listener and pinned to its certificate's SPKI hash. Chrome's paths
// and profiles stay in the app config, whatever the
// connection. It never calls the service's POST /chrome/start.
func (a *App) StartBrowser(start ChromeStart) error {
	address, port, err := chromeProxy(start)
	if err != nil {
		return err
	}
	if start.SPKIHash == "" {
		return errors.New("starting Chrome: the certificate has no SPKI hash")
	}
	profile := strings.TrimSpace(start.Profile)
	if profile == "" {
		profile = "default-profile"
	}
	if profile != "default-profile" {
		profiles, _ := a.GetChromeProfiles()
		if !slices.Contains(profiles, profile) {
			return fmt.Errorf("starting Chrome: profile %s: %w", profile, errChromeNotFound)
		}
	}
	paths, _ := a.GetChromePaths()
	launch := ChromeLaunch{
		Address:   address,
		Port:      port,
		SPKIHash:  start.SPKIHash,
		ConfigDir: a.chromeConfigDir,
		Profile:   profile,
		Paths:     paths,
	}
	if err := a.launchChrome(launch); err != nil {
		return fmt.Errorf("starting Chrome: %w", err)
	}
	return nil
}

// chromeProxy is the address and port Chrome on this machine reaches the
// proxy listener at. A listener on every address is reached at loopback on
// the local connection and at the service's host on a remote one; a remote
// listener on loopback only is refused.
func chromeProxy(start ChromeStart) (address, port string, err error) {
	if start.ProxyListener == "" {
		return "", "", fmt.Errorf("starting Chrome: %s: %w", listenerInactive, errListenerInactive)
	}
	host, port, err := net.SplitHostPort(start.ProxyListener)
	if err != nil {
		return "", "", fmt.Errorf("starting Chrome: reading the proxy listener %q: %w", start.ProxyListener, err)
	}
	remote := start.ConnectionKind == "remote"
	ip, parseErr := netip.ParseAddr(host)
	switch {
	case host == "" || (parseErr == nil && ip.IsUnspecified()):
		if !remote {
			return "127.0.0.1", port, nil
		}
		serviceURL, err := url.Parse(start.ConnectionURL)
		if err != nil || serviceURL.Hostname() == "" {
			return "", "", fmt.Errorf("starting Chrome: reading the connection address %q", start.ConnectionURL)
		}
		return serviceURL.Hostname(), port, nil
	case remote && (strings.EqualFold(host, "localhost") || (parseErr == nil && ip.IsLoopback())):
		return "", "", fmt.Errorf("starting Chrome: %s: %w", listenerLoopback, errListenerLoopback)
	}
	return host, port, nil
}
