package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestAppWaypoints(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte("origin" + request.URL.Path))
	}))
	defer origin.Close()
	originURL, err := url.Parse(origin.URL)
	if err != nil {
		t.Fatalf("parsing origin url: %v", err)
	}

	app := newScratchpadApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	proxyURL := &url.URL{Scheme: "http", Host: listenerAddress(t, app)}
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL), DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}

	t.Run("should route a host to its override once created", func(t *testing.T) {
		if err := app.CreateWaypoint("marasi.test:80", originURL.Host); err != nil {
			t.Fatalf("creating waypoint: %v", err)
		}
		if body := proxiedBody(t, client, "http://marasi.test/routed"); body != "origin/routed" {
			t.Fatalf("wanted: %q\ngot: %q", "origin/routed", body)
		}
	})

	t.Run("should stop routing a host once deleted", func(t *testing.T) {
		if err := app.DeleteWaypoint("marasi.test:80"); err != nil {
			t.Fatalf("deleting waypoint: %v", err)
		}
		if body := proxiedBody(t, client, "http://marasi.test/unrouted"); body == "origin/unrouted" {
			t.Fatalf("wanted request not routed to origin\ngot: %q", body)
		}
	})
}

func proxiedBody(t *testing.T, client *http.Client, target string) string {
	t.Helper()
	response, err := client.Get(target)
	if err != nil {
		t.Fatalf("requesting %s through the proxy: %v", target, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", target, err)
	}
	return string(body)
}
