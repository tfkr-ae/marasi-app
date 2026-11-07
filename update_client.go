package main

import (
	"net"
	"net/http"
	"net/url"
	"time"
)

// updateHTTPClient is the client every update request (release checks and
// downloads) goes through. It is its own client, never the proxy's
// transport, so update traffic stays out of the researcher's project. It
// honours the system proxy, except a system proxy that is Marasi's own
// listener (see updateProxy).
func (a *App) updateHTTPClient() *http.Client {
	if a.updateClient != nil {
		return a.updateClient
	}
	systemProxy := a.systemProxy
	if systemProxy == nil {
		systemProxy = readSystemProxy()
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy: func(request *http.Request) (*url.URL, error) {
				return a.updateProxy(systemProxy, request)
			},
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 30 * time.Second,
		},
	}
}

// updateProxy is the proxy an update request goes through: the system
// proxy, unless that is a running Marasi listener. Researchers often point
// the system proxy at Marasi; going through it would put the app's own
// update traffic in their project's ledger, so then the request goes
// direct. The listener is checked per request because it can start, stop
// or move while a download runs.
func (a *App) updateProxy(systemProxy func(*http.Request) (*url.URL, error), request *http.Request) (*url.URL, error) {
	proxy, err := systemProxy(request)
	if err != nil || proxy == nil {
		return proxy, err
	}
	if a.isMarasiListener(proxy) {
		return nil, nil
	}
	return proxy, nil
}

// isMarasiListener reports whether proxy is the address of the local
// instance's running proxy listener. The listener may be bound to a wildcard address, and the proxy
// may name it as localhost or another of this machine's addresses, so the
// two match on port and on reaching the same machine, not as strings.
func (a *App) isMarasiListener(proxy *url.URL) bool {
	if a.localProxyListener == nil {
		return false
	}
	listener := a.localProxyListener()
	if listener == "" {
		return false
	}
	listenerHost, listenerPort, err := net.SplitHostPort(listener)
	if err != nil || listenerPort != proxyPort(proxy) {
		return false
	}
	listenerIP := net.ParseIP(listenerHost)
	for _, ip := range resolveHost(proxy.Hostname()) {
		switch {
		case listenerIP == nil || listenerIP.IsUnspecified():
			if ip.IsLoopback() || isLocalAddress(ip) {
				return true
			}
		case ip.Equal(listenerIP), ip.IsLoopback() && listenerIP.IsLoopback():
			return true
		}
	}
	return false
}

// proxyPort is the port proxy listens on, defaulting by scheme.
func proxyPort(proxy *url.URL) string {
	if port := proxy.Port(); port != "" {
		return port
	}
	switch proxy.Scheme {
	case "https":
		return "443"
	case "socks5", "socks5h":
		return "1080"
	default:
		return "80"
	}
}

// resolveHost returns the addresses host names; none if it does not resolve.
func resolveHost(host string) []net.IP {
	if ip := net.ParseIP(host); ip != nil {
		return []net.IP{ip}
	}
	if host == "localhost" {
		return []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback}
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return nil
	}
	return ips
}

// isLocalAddress reports whether ip is assigned to one of this machine's
// network interfaces.
func isLocalAddress(ip net.IP) bool {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, address := range addresses {
		if network, ok := address.(*net.IPNet); ok && network.IP.Equal(ip) {
			return true
		}
	}
	return false
}
