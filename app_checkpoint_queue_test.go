package main

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
)

func TestAppCheckpointAbandoned(t *testing.T) {
	t.Run("should emit checkpoint-abandoned with the item id and type when its client leaves", func(t *testing.T) {
		app := newCheckpointApp(t)
		events := &recordedEvents{}
		app.emitEvent = events.emit
		ctx, leave := context.WithCancel(context.Background())
		_, reqID, done := startAppRequestHoldContext(t, app, ctx)
		waitForAppCheckpoint(t, app, 1)

		leave()

		if err := receiveAppHoldResult(t, done); !errors.Is(err, marasi.ErrDropped) {
			t.Fatalf("wanted: %v\ngot: %v", marasi.ErrDropped, err)
		}
		data := waitForEvent(t, events, "checkpoint-abandoned")
		got, ok := data[0].(CheckpointAbandoned)
		if !ok {
			t.Fatalf("wanted checkpoint-abandoned data CheckpointAbandoned\ngot: %T", data[0])
		}
		want := CheckpointAbandoned{ID: reqID, Type: domain.CheckpointTypeRequest}
		if got != want {
			t.Fatalf("wanted: %+v\ngot: %+v", want, got)
		}
	})
}

func TestAppCheckpointInterceptedAt(t *testing.T) {
	t.Run("should list items oldest first with the time each was intercepted", func(t *testing.T) {
		app := newCheckpointApp(t)
		before := time.Now()
		_, firstID, firstDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		_, secondID, secondDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 2)
		after := time.Now()

		items := app.GetCheckpointItems()
		if items[0].ID != firstID || items[1].ID != secondID {
			t.Fatalf("wanted order %s, %s\ngot: %s, %s", firstID, secondID, items[0].ID, items[1].ID)
		}
		for _, item := range items {
			if item.InterceptedAt.Before(before) || item.InterceptedAt.After(after) {
				t.Fatalf("wanted %s intercepted between %v and %v\ngot: %v", item.ID, before, after, item.InterceptedAt)
			}
		}
		if items[1].InterceptedAt.Before(items[0].InterceptedAt) {
			t.Fatalf("wanted second intercepted no earlier than first\ngot: %v then %v", items[0].InterceptedAt, items[1].InterceptedAt)
		}
		dropAppHolds(t, app, firstDone, secondDone)
	})

	t.Run("should restamp a response held after its request was forwarded", func(t *testing.T) {
		app := newCheckpointApp(t)
		req, reqID, requestDone := startAppRequestHold(t, app)
		requestAt := waitForAppCheckpoint(t, app, 1)[0].InterceptedAt
		time.Sleep(5 * time.Millisecond)
		if err := app.ForwardCheckpoint(reqID, "", true); err != nil {
			t.Fatalf("forwarding request: %v", err)
		}
		if err := receiveAppHoldResult(t, requestDone); err != nil {
			t.Fatalf("wanted: nil\ngot: %v", err)
		}
		responseDone := make(chan error, 1)
		go func() {
			responseDone <- marasi.CheckpointResponseModifier(app.Proxy, &http.Response{Header: make(http.Header), Request: req})
		}()
		response := waitForAppCheckpoint(t, app, 1)[0]
		if response.Type != domain.CheckpointTypeResponse || !response.InterceptedAt.After(requestAt) {
			t.Fatalf("wanted response intercepted after %v\ngot: %s at %v", requestAt, response.Type, response.InterceptedAt)
		}
		dropAppHolds(t, app, responseDone)
	})

	t.Run("should forget the time once an item is forwarded, dropped or abandoned", func(t *testing.T) {
		app := newCheckpointApp(t)
		_, forwardedID, forwardedDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 1)
		_, droppedID, droppedDone := startAppRequestHold(t, app)
		waitForAppCheckpoint(t, app, 2)
		ctx, leave := context.WithCancel(context.Background())
		_, abandonedID, abandonedDone := startAppRequestHoldContext(t, app, ctx)
		waitForAppCheckpoint(t, app, 3)

		if err := app.ForwardCheckpoint(forwardedID, "", false); err != nil {
			t.Fatalf("forwarding: %v", err)
		}
		if err := app.DropCheckpoint(droppedID); err != nil {
			t.Fatalf("dropping: %v", err)
		}
		leave()
		receiveAppHoldResult(t, forwardedDone)
		receiveAppHoldResult(t, droppedDone)
		receiveAppHoldResult(t, abandonedDone)

		for _, id := range []uuid.UUID{forwardedID, droppedID, abandonedID} {
			if at, ok := app.checkpointTimes.get(id); ok {
				t.Fatalf("wanted no interception time for %s\ngot: %v", id, at)
			}
		}
	})
}

// dropAppHolds drops every held item and waits for each hold to end.
func dropAppHolds(t *testing.T, app *App, done ...<-chan error) {
	t.Helper()
	for _, item := range app.GetCheckpointItems() {
		if err := app.DropCheckpoint(item.ID); err != nil {
			t.Fatalf("dropping %s: %v", item.ID, err)
		}
	}
	for _, result := range done {
		receiveAppHoldResult(t, result)
	}
}
