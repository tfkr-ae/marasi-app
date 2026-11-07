package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

func TestUpdateCheckGoesThroughTheSystemProxy(t *testing.T) {
	releases := newFakeReleaseServer(t)
	releases.publishRelease("18.10.2026", "")
	corporate := newForwardProxy(t)
	app, _ := newUpdateApp(t, "release", "17.10.2026", releases)
	app.systemProxy = alwaysProxy(corporate.url)

	if check := app.CheckForUpdate(); check.Outcome != UpdateOutcomeAvailable {
		t.Fatalf("wanted an update found through the system proxy, got %+v", check)
	}
	if n := corporate.forwarded.Load(); n != 1 {
		t.Fatalf("wanted the check forwarded once by the system proxy, got %d", n)
	}
}

func TestUpdateCheckBypassesASystemProxyThatIsMarasi(t *testing.T) {
	cases := []struct {
		name     string
		listener func(proxy string) string
		host     func(proxy string) string
	}{
		{"as the listener's address", func(proxy string) string { return proxy }, func(proxy string) string { return proxy }},
		{"as localhost", func(proxy string) string { return proxy }, func(proxy string) string {
			_, port, _ := net.SplitHostPort(proxy)
			return net.JoinHostPort("localhost", port)
		}},
		{"on a listener bound to every address", func(proxy string) string {
			_, port, _ := net.SplitHostPort(proxy)
			return net.JoinHostPort("0.0.0.0", port)
		}, func(proxy string) string { return proxy }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			releases := newFakeReleaseServer(t)
			releases.publishRelease("18.10.2026", "")
			// The local instance's proxy listener, which would put the
			// app's own update traffic in the open project.
			marasiListener := newForwardProxy(t)
			app, _ := newUpdateApp(t, "release", "17.10.2026", releases)
			app.localProxyListener = func() string { return c.listener(marasiListener.url.Host) }
			app.systemProxy = alwaysProxy(&url.URL{Scheme: "http", Host: c.host(marasiListener.url.Host)})

			if check := app.CheckForUpdate(); check.Outcome != UpdateOutcomeAvailable {
				t.Fatalf("wanted an update found, got %+v", check)
			}
			if n := marasiListener.forwarded.Load(); n != 0 {
				t.Fatalf("wanted no update request through Marasi's listener, got %d", n)
			}
		})
	}
}

func TestUpdateCheckUsesASystemProxyWhenNoLocalListenerRuns(t *testing.T) {
	releases := newFakeReleaseServer(t)
	releases.publishRelease("18.10.2026", "")
	corporate := newForwardProxy(t)
	app, _ := newUpdateApp(t, "release", "17.10.2026", releases)
	app.localProxyListener = func() string { return "" }
	app.systemProxy = alwaysProxy(corporate.url)

	if check := app.CheckForUpdate(); check.Outcome != UpdateOutcomeAvailable {
		t.Fatalf("wanted an update found, got %+v", check)
	}
	if n := corporate.forwarded.Load(); n != 1 {
		t.Fatalf("wanted the check forwarded once by the system proxy, got %d", n)
	}
}

func alwaysProxy(proxy *url.URL) func(*http.Request) (*url.URL, error) {
	return func(*http.Request) (*url.URL, error) { return proxy, nil }
}

type forwardProxy struct {
	url       *url.URL
	forwarded atomic.Int64
}

// newForwardProxy starts a plain HTTP forward proxy standing in for a
// corporate proxy, counting the requests it forwards.
func newForwardProxy(t *testing.T) *forwardProxy {
	t.Helper()
	proxy := &forwardProxy{}
	transport := &http.Transport{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy.forwarded.Add(1)
		outgoing := r.Clone(r.Context())
		outgoing.RequestURI = ""
		response, err := transport.RoundTrip(outgoing)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		for name, values := range response.Header {
			w.Header()[name] = values
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(transport.CloseIdleConnections)
	proxy.url, _ = url.Parse(server.URL)
	return proxy
}
