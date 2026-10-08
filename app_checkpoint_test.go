package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"testing"
	"time"

	"github.com/google/martian"
	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/core"
	"github.com/tfkr-ae/marasi/domain"
	marasiws "github.com/tfkr-ae/marasi/websocket"
)

func TestAppCheckpoint(t *testing.T) {
	t.Run("should list and get pending HTTP checkpoint items by id", func(t *testing.T) {
		app := newCheckpointApp(t)
		_, reqID, done := startAppRequestHold(t, app)
		items := waitForAppCheckpoint(t, app, 1)
		if items[0].ID != reqID {
			t.Fatalf("wanted id %s\ngot: %s", reqID, items[0].ID)
		}
		if items[0].Type != domain.CheckpointTypeRequest {
			t.Fatalf("wanted type %s\ngot: %s", domain.CheckpointTypeRequest, items[0].Type)
		}
		got := app.GetCheckpoint(reqID)
		if got == nil || got.ID != reqID {
			t.Fatalf("wanted get-by-id %s\ngot: %v", reqID, got)
		}
		if err := app.DropCheckpoint(reqID); err != nil {
			t.Fatalf("dropping checkpoint: %v", err)
		}
		if err := receiveAppHoldResult(t, done); !errors.Is(err, marasi.ErrDropped) {
			t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
		}
		if remaining := app.GetCheckpointItems(); len(remaining) != 0 {
			t.Fatalf("wanted empty list, got %d items", len(remaining))
		}
	})

	t.Run("should drop any pending id not only the head", func(t *testing.T) {
		app := newCheckpointApp(t)
		_, firstID, firstDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		_, secondID, secondDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 2)

		if err := app.DropCheckpoint(secondID); err != nil {
			t.Fatalf("dropping second checkpoint: %v", err)
		}
		if err := receiveAppHoldResult(t, secondDone); !errors.Is(err, marasi.ErrDropped) {
			t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
		}
		items := app.GetCheckpointItems()
		if len(items) != 1 || items[0].ID != firstID {
			t.Fatalf("wanted remaining id %s\ngot: %v", firstID, items)
		}
		select {
		case err := <-firstDone:
			t.Fatalf("wanted first hold to remain blocked\ngot: %v", err)
		default:
		}
		if err := app.DropCheckpoint(firstID); err != nil {
			t.Fatalf("dropping first checkpoint: %v", err)
		}
		if err := receiveAppHoldResult(t, firstDone); !errors.Is(err, marasi.ErrDropped) {
			t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
		}
	})

	t.Run("should forward by id with editor bytes", func(t *testing.T) {
		app := newCheckpointApp(t)
		req, reqID, done := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		modified := "POST / HTTP/1.1\r\nHost: marasi.app\r\nContent-Length: 12\r\nContent-Type: text/plain\r\n\r\nhello marasi"
		if err := app.ForwardCheckpoint(reqID, modified, false); err != nil {
			t.Fatalf("forwarding checkpoint: %v", err)
		}
		if err := receiveAppHoldResult(t, done); err != nil {
			t.Fatalf("wanted: nil\ngot: %v", err)
		}
		got, err := httputil.DumpRequest(req, true)
		if err != nil {
			t.Fatalf("dumping request: %v", err)
		}
		if string(got) != modified {
			t.Fatalf("wanted:\n%q\ngot:\n%q", modified, got)
		}
		if flag, ok := core.InterceptFlagFromContext(req.Context()); ok || flag {
			t.Fatalf("wanted intercept_response: false")
		}
	})

	t.Run("should forward a request with intercept_response and editor bytes", func(t *testing.T) {
		app := newCheckpointApp(t)
		req, reqID, requestDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		modified := "POST / HTTP/1.1\r\nHost: marasi.app\r\nContent-Length: 12\r\nContent-Type: text/plain\r\n\r\nhello marasi"
		if err := app.ForwardCheckpoint(reqID, modified, true); err != nil {
			t.Fatalf("forwarding checkpoint: %v", err)
		}
		if err := receiveAppHoldResult(t, requestDone); err != nil {
			t.Fatalf("wanted: nil\ngot: %v", err)
		}
		got, err := httputil.DumpRequest(req, true)
		if err != nil {
			t.Fatalf("dumping request: %v", err)
		}
		if string(got) != modified {
			t.Fatalf("wanted:\n%q\ngot:\n%q", modified, got)
		}
		if flag, ok := core.InterceptFlagFromContext(req.Context()); !ok || !flag {
			t.Fatalf("wanted intercept_response: true")
		}

		res := &http.Response{Header: make(http.Header), Request: req}
		responseDone := make(chan error, 1)
		go func() {
			responseDone <- marasi.CheckpointResponseModifier(app.Proxy, res)
		}()
		items := waitForAppCheckpoint(t, app, 1)
		if items[0].ID != reqID || items[0].Type != domain.CheckpointTypeResponse {
			t.Fatalf("wanted response %s\ngot: %s %s", reqID, items[0].Type, items[0].ID)
		}
		if err := app.DropCheckpoint(reqID); err != nil {
			t.Fatalf("dropping response: %v", err)
		}
		if err := receiveAppHoldResult(t, responseDone); !errors.Is(err, marasi.ErrDropped) {
			t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
		}
	})

	t.Run("should set HTTP and WebSocket intercept flags independently", func(t *testing.T) {
		app := newProjectApp(t)
		if app.SetIntercept(true) != true {
			t.Fatal("wanted HTTP intercept: true")
		}
		if !app.GetInterceptFlag() {
			t.Fatal("wanted GetInterceptFlag: true")
		}
		if app.GetWSInterceptFlag() {
			t.Fatal("wanted WebSocket intercept: false")
		}
		if app.SetWSIntercept(true) != true {
			t.Fatal("wanted WebSocket intercept: true")
		}
		if !app.GetInterceptFlag() || !app.GetWSInterceptFlag() {
			t.Fatal("wanted both flags true")
		}
		if app.SetIntercept(false) != false {
			t.Fatal("wanted HTTP intercept: false")
		}
		if app.GetInterceptFlag() {
			t.Fatal("wanted GetInterceptFlag: false")
		}
		if !app.GetWSInterceptFlag() {
			t.Fatal("wanted WebSocket intercept left on")
		}
	})

	t.Run("should drop a WebSocket checkpoint item by id", func(t *testing.T) {
		app := newProjectApp(t)
		message, done := startAppWebSocketHold(t, app)
		items := waitForAppCheckpoint(t, app, 1)
		if items[0].ID != message.ID || items[0].Type != domain.CheckpointTypeWebSocket {
			t.Fatalf("wanted websocket %s\ngot: %s %s", message.ID, items[0].Type, items[0].ID)
		}
		if err := app.DropCheckpoint(message.ID); err != nil {
			t.Fatalf("dropping websocket: %v", err)
		}
		if err := receiveAppHoldResult(t, done); err != nil {
			t.Fatalf("wanted: nil\ngot: %v", err)
		}
		if remaining := app.GetCheckpointItems(); len(remaining) != 0 {
			t.Fatalf("wanted empty list, got %d items", len(remaining))
		}
	})

	t.Run("should forward a WebSocket checkpoint item by id with payload", func(t *testing.T) {
		app := newProjectApp(t)
		message, done := startAppWebSocketHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		if err := app.ForwardCheckpoint(message.ID, "edited", false); err != nil {
			t.Fatalf("forwarding websocket: %v", err)
		}
		if err := receiveAppHoldResult(t, done); err != nil {
			t.Fatalf("wanted: nil\ngot: %v", err)
		}
		if string(message.Frame.Payload) != "edited" {
			t.Fatalf("wanted payload %q\ngot: %q", "edited", message.Frame.Payload)
		}
	})

	t.Run("should drop pending HTTP and WebSocket items on app exit", func(t *testing.T) {
		app := newCheckpointApp(t)
		_, _, requestDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		_, webSocketDone := startAppWebSocketHold(t, app)
		waitForAppCheckpoint(t, app, 2)

		app.close(context.Background())

		if err := receiveAppHoldResult(t, requestDone); !errors.Is(err, marasi.ErrDropped) {
			t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
		}
		if err := receiveAppHoldResult(t, webSocketDone); err != nil {
			t.Fatalf("wanted: nil\ngot: %v", err)
		}
		if remaining := app.GetCheckpointItems(); len(remaining) != 0 {
			t.Fatalf("wanted empty list, got %d items", len(remaining))
		}
	})
}

func newCheckpointApp(t *testing.T) *App {
	t.Helper()
	app := newProjectApp(t)
	if err := app.SetupScratchpad(); err != nil {
		t.Fatalf("opening scratchpad: %v", err)
	}
	app.SetIntercept(true)
	return app
}

func startAppRequestHold(t *testing.T, app *App) (*http.Request, uuid.UUID, <-chan error) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "https://marasi.app", nil)
	_, remove, err := martian.TestContext(req, nil, nil)
	if err != nil {
		t.Fatalf("applying martian context: %v", err)
	}
	t.Cleanup(remove)
	if err := marasi.SetupRequestModifier(app.Proxy, req); err != nil {
		t.Fatalf("running SetupRequestModifier: %v", err)
	}
	reqID, ok := core.RequestIDFromContext(req.Context())
	if !ok {
		t.Fatal("request id missing")
	}
	done := make(chan error, 1)
	go func() {
		done <- marasi.CheckpointRequestModifier(app.Proxy, req)
	}()
	return req, reqID, done
}

func startAppWebSocketHold(t *testing.T, app *App) (*marasiws.Message, <-chan error) {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("creating message id: %v", err)
	}
	message := &marasiws.Message{
		ID:           id,
		ConnectionID: uuid.New(),
		RequestID:    uuid.New(),
		Frame:        marasiws.Frame{Opcode: marasiws.OpText, Payload: []byte("held")},
	}
	done := make(chan error, 1)
	go func() {
		done <- app.Proxy.WebSocketInterceptor.Intercept(message, nil)
	}()
	return message, done
}

func waitForAppCheckpoint(t *testing.T, app *App, n int) []domain.CheckpointItem {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		items := app.GetCheckpointItems()
		if len(items) == n {
			return items
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d checkpoint items, got %d", n, len(app.GetCheckpointItems()))
	return nil
}

func receiveAppHoldResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for checkpoint hold")
		return nil
	}
}
