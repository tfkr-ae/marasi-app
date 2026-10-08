package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"
	"time"
	"unsafe"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/db"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/service"
)

func TestStartProxyRejectsWhileActive(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	first := listenerAddress(t, app)
	if err := app.StartProxy("127.0.0.1", "0"); !errors.Is(err, service.ErrListenerAlreadyActive) {
		t.Fatalf("wanted %v, got %v", service.ErrListenerAlreadyActive, err)
	}
	connection, err := net.DialTimeout("tcp", first, time.Second)
	if err != nil {
		t.Fatalf("dialing original listener: %v", err)
	}
	connection.Close()
}

func TestStartProxyRequiresCompleteEndpoint(t *testing.T) {
	app := newListenerApp(t)
	for _, endpoint := range [][2]string{{"", "8080"}, {"127.0.0.1", ""}, {"127.0.0.1", "nope"}} {
		if err := app.StartProxy(endpoint[0], endpoint[1]); !errors.Is(err, service.ErrListenerUnavailable) {
			t.Fatalf("wanted %v for %q:%q, got %v", service.ErrListenerUnavailable, endpoint[0], endpoint[1], err)
		}
	}
}

func TestUpdateProxyRequiresCompleteEndpoint(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	first := listenerAddress(t, app)
	for _, endpoint := range [][2]string{{"", "8080"}, {"127.0.0.1", ""}, {"127.0.0.1", "nope"}} {
		if err := app.UpdateProxy(endpoint[0], endpoint[1]); !errors.Is(err, service.ErrListenerUnavailable) {
			t.Fatalf("wanted %v for %q:%q, got %v", service.ErrListenerUnavailable, endpoint[0], endpoint[1], err)
		}
	}
	connection, err := net.DialTimeout("tcp", first, time.Second)
	if err != nil {
		t.Fatalf("dialing original listener after rejected update: %v", err)
	}
	connection.Close()
}

func TestStopProxyRejectsNewConnectionsAndAllowsRestart(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	first := listenerAddress(t, app)
	if err := app.StopProxy(); err != nil {
		t.Fatalf("stopping listener: %v", err)
	}
	if connection, err := net.DialTimeout("tcp", first, 50*time.Millisecond); err == nil {
		connection.Close()
		t.Fatal("wanted new TCP connections rejected after Stop")
	}
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("restarting listener: %v", err)
	}
	connection, err := net.DialTimeout("tcp", listenerAddress(t, app), time.Second)
	if err != nil {
		t.Fatalf("dialing restarted listener: %v", err)
	}
	connection.Close()
}

func TestUpdateProxyLeavesActiveListenerWhenBindFails(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	first := listenerAddress(t, app)
	blocker, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("binding blocking listener: %v", err)
	}
	defer blocker.Close()
	_, port, err := net.SplitHostPort(blocker.Addr().String())
	if err != nil {
		t.Fatalf("reading blocking port: %v", err)
	}
	if err := app.UpdateProxy("127.0.0.1", port); err == nil {
		t.Fatal("wanted update bind failure")
	}
	connection, err := net.DialTimeout("tcp", first, time.Second)
	if err != nil {
		t.Fatalf("dialing original listener after failed update: %v", err)
	}
	connection.Close()
}

func TestUpdateProxyServesReplacement(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	first := listenerAddress(t, app)
	if err := app.UpdateProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("updating listener: %v", err)
	}
	updated := listenerAddress(t, app)
	if updated == first {
		t.Fatalf("wanted replacement endpoint, got %s", updated)
	}
	if connection, err := net.DialTimeout("tcp", first, 50*time.Millisecond); err == nil {
		connection.Close()
		t.Fatal("wanted old listener closed")
	}
	connection, err := net.DialTimeout("tcp", updated, time.Second)
	if err != nil {
		t.Fatalf("dialing replacement listener: %v", err)
	}
	connection.Close()
}

func TestStopProxyLetsAcceptedHTTPContinue(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseResponse := make(chan struct{})
	origin := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/accepted-before-stop" {
			close(requestStarted)
			<-releaseResponse
		}
		_, _ = response.Write([]byte(request.URL.Path))
	}))
	defer origin.Close()

	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	proxyURL := &url.URL{Scheme: "http", Host: listenerAddress(t, app)}
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}

	firstResult := make(chan error, 1)
	go func() {
		response, requestErr := client.Get(origin.URL + "/accepted-before-stop")
		if requestErr != nil {
			firstResult <- requestErr
			return
		}
		defer response.Body.Close()
		body, readErr := io.ReadAll(response.Body)
		if readErr == nil && string(body) != "/accepted-before-stop" {
			readErr = fmt.Errorf("unexpected response body %q", body)
		}
		firstResult <- readErr
	}()
	<-requestStarted

	if err := app.StopProxy(); err != nil {
		t.Fatalf("stopping listener: %v", err)
	}
	if connection, err := net.DialTimeout("tcp", proxyURL.Host, 50*time.Millisecond); err == nil {
		connection.Close()
		t.Fatal("wanted new TCP connections rejected after Stop")
	}
	close(releaseResponse)
	if err := <-firstResult; err != nil {
		t.Fatalf("finishing accepted request: %v", err)
	}

	response, err := client.Get(origin.URL + "/keep-alive-after-stop")
	if err != nil {
		t.Fatalf("sending request on accepted keep-alive connection: %v", err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || string(body) != "/keep-alive-after-stop" {
		t.Fatalf("reading keep-alive response: %q, %v", body, err)
	}
	if _, err := app.Proxy.TrafficRepo.GetRequestResponseSummary(); err != nil {
		t.Fatalf("reading open project after listener stop: %v", err)
	}
}

func TestCloseUsesTerminalShutdown(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	app.close(context.Background())
	if err := app.StartProxy("127.0.0.1", "0"); err == nil {
		t.Fatal("wanted start after shutdown to fail")
	}
}

func TestCloseInterruptsExtensionHoldingRequest(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(request.URL.Path))
	}))
	defer origin.Close()

	app := newScratchpadApp(t)
	events := &recordedEvents{}
	if err := app.attachExtensionHooks(events.emit); err != nil {
		t.Fatalf("attaching extension hooks: %v", err)
	}
	hang := `function processRequest(request) print("entered"); while true do end end`
	if err := app.RunExtension("workshop", hang); err != nil {
		t.Fatalf("installing hanging hook: %v", err)
	}
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	proxyURL := &url.URL{Scheme: "http", Host: listenerAddress(t, app)}
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	go func() {
		if response, err := client.Get(origin.URL + "/held-by-extension"); err == nil {
			response.Body.Close()
		}
	}()
	waitForExtensionLog(t, app, "workshop", "entered")
	if !events.has("workshop-log") {
		t.Fatal("wanted workshop-log event for the hook's print")
	}

	closed := make(chan struct{})
	go func() {
		app.close(context.Background())
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("wanted close to interrupt the extension holding the request")
	}
}

func TestStartProxyRecoversAfterUnexpectedServingFailure(t *testing.T) {
	app := newListenerApp(t)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	closeActiveProxyListener(t, app.Proxy)
	waitForListenerState(t, app, service.ListenerInactive)
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("restarting listener after unexpected failure: %v", err)
	}
	connection, err := net.DialTimeout("tcp", listenerAddress(t, app), time.Second)
	if err != nil {
		t.Fatalf("dialing restarted listener: %v", err)
	}
	connection.Close()
}

func newListenerApp(t *testing.T) *App {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	configDir := t.TempDir()
	database, err := db.New(filepath.Join(t.TempDir(), "project.marasi"), logger)
	if err != nil {
		t.Fatalf("opening project: %v", err)
	}
	repository := db.NewProxyRepo(database)
	extensions, err := repository.GetExtensions()
	if err != nil {
		t.Fatalf("getting default extensions: %v", err)
	}
	proxy, err := marasi.New(
		marasi.WithLogger(logger),
		marasi.WithConfigDir(configDir),
		marasi.WithDefaultRepositories(repository),
		marasi.WithExtensions(extensions),
		marasi.WithRequestHandler(func(domain.ProxyRequest) error { return nil }),
		marasi.WithResponseHandler(func(domain.ProxyResponse) error { return nil }),
		marasi.WithLogHandler(func(domain.Log) error { return nil }),
		marasi.WithBasePipeline(),
		marasi.WithDefaultModifierPipeline(),
	)
	if err != nil {
		t.Fatalf("creating proxy: %v", err)
	}
	lifecycle := service.NewListenerLifecycle(proxy, io.Discard)
	t.Cleanup(func() {
		if err := lifecycle.Shutdown(); err != nil {
			t.Fatalf("shutting down listener: %v", err)
		}
	})
	return &App{Proxy: proxy, listener: lifecycle}
}

func listenerAddress(t *testing.T, app *App) string {
	t.Helper()
	status := app.listener.Status()
	if status.ProxyListener == nil {
		t.Fatal("wanted proxy listener address, got null")
	}
	return *status.ProxyListener
}

func waitForListenerState(t *testing.T, app *App, want service.ListenerState) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for app.listener.Status().Status != want {
		if time.Now().After(deadline) {
			t.Fatalf("wanted %s, got %+v", want, app.listener.Status())
		}
		time.Sleep(time.Millisecond)
	}
}

func closeActiveProxyListener(t *testing.T, proxy *marasi.Proxy) {
	t.Helper()
	field := reflect.ValueOf(proxy).Elem().FieldByName("activeListener")
	if !field.IsValid() || field.IsNil() {
		t.Fatal("wanted active proxy listener")
	}
	listener := *(*net.Listener)(unsafe.Pointer(field.UnsafeAddr()))
	if err := listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
		t.Fatalf("closing active proxy listener: %v", err)
	}
}

func waitForExtensionLog(t *testing.T, app *App, name, text string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		logs, err := app.GetExtensionLogs(name)
		if err != nil {
			t.Fatalf("reading %s logs: %v", name, err)
		}
		for _, entry := range logs {
			if entry.Text == text {
				return
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s log %q", name, text)
}

type recordedEvents struct {
	mu    sync.Mutex
	names []string
}

func (events *recordedEvents) emit(name string, _ ...any) {
	events.mu.Lock()
	defer events.mu.Unlock()
	events.names = append(events.names, name)
}

func (events *recordedEvents) has(name string) bool {
	events.mu.Lock()
	defer events.mu.Unlock()
	return slices.Contains(events.names, name)
}
