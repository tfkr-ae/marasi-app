package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
)

func TestAppLaunch(t *testing.T) {
	t.Run("should return the launch id and report the launch started and completed", func(t *testing.T) {
		app, events, launchpadID, origin := newLaunchApp(t)

		id, err := app.Launch(rawGet(origin, "/fast"), launchpadID.String(), false)
		if err != nil {
			t.Fatalf("launching: %v", err)
		}
		if id == uuid.Nil {
			t.Fatal("wanted a launch id, got uuid.Nil")
		}

		started := launchEvent(t, events, "launch-started")
		if started.ID != id || started.LaunchpadID != launchpadID || started.Status != domain.LaunchPending {
			t.Fatalf("wanted pending launch %s in %s\ngot: %+v", id, launchpadID, started)
		}
		finished := launchEvent(t, events, "launch-finished")
		if finished.ID != id || finished.Status != domain.LaunchCompleted {
			t.Fatalf("wanted completed launch %s\ngot: %+v", id, finished)
		}
		got, err := app.GetLaunch(id)
		if err != nil || got.Status != domain.LaunchCompleted {
			t.Fatalf("wanted GetLaunch completed\ngot: %+v %v", got, err)
		}
	})

	t.Run("should fail at once on a malformed request or a missing Host", func(t *testing.T) {
		app, events, launchpadID, _ := newLaunchApp(t)
		for _, raw := range []string{"not a request", "GET / HTTP/1.1\r\n\r\n"} {
			id, err := app.Launch(raw, launchpadID.String(), true)
			if err == nil {
				t.Fatalf("wanted an error launching %q", raw)
			}
			if id != uuid.Nil {
				t.Fatalf("wanted uuid.Nil for %q, got %s", raw, id)
			}
		}
		if events.has("launch-started") {
			t.Fatal("wanted no launch-started event for a launch that never started")
		}
	})

	t.Run("should list a pending launch and cancel it", func(t *testing.T) {
		app, events, launchpadID, origin := newLaunchApp(t)

		id, err := app.Launch(rawGet(origin, "/slow?sleep=10"), launchpadID.String(), false)
		if err != nil {
			t.Fatalf("launching: %v", err)
		}
		pending := app.PendingLaunches()
		if len(pending) != 1 || pending[0].ID != id || pending[0].Status != domain.LaunchPending {
			t.Fatalf("wanted pending launch %s\ngot: %+v", id, pending)
		}

		cancelled, err := app.CancelLaunch(id)
		if err != nil {
			t.Fatalf("cancelling: %v", err)
		}
		if cancelled.Status != domain.LaunchCancelled {
			t.Fatalf("wanted cancelled\ngot: %+v", cancelled)
		}
		finished := launchEvent(t, events, "launch-finished")
		if finished.ID != id || finished.Status != domain.LaunchCancelled {
			t.Fatalf("wanted launch-finished cancelled for %s\ngot: %+v", id, finished)
		}
		if pending := app.PendingLaunches(); len(pending) != 0 {
			t.Fatalf("wanted no pending launches, got %+v", pending)
		}
	})

	t.Run("should return a finished launch's final state when cancelled too late", func(t *testing.T) {
		app, events, launchpadID, origin := newLaunchApp(t)
		id, err := app.Launch(rawGet(origin, "/fast"), launchpadID.String(), false)
		if err != nil {
			t.Fatalf("launching: %v", err)
		}
		launchEvent(t, events, "launch-finished")

		got, err := app.CancelLaunch(id)
		if err != nil {
			t.Fatalf("wanted a finished launch cancelled quietly, got %v", err)
		}
		if got.ID != id || got.Status != domain.LaunchCompleted {
			t.Fatalf("wanted completed launch %s\ngot: %+v", id, got)
		}
	})

	t.Run("should report an unknown launch id", func(t *testing.T) {
		app, _, _, _ := newLaunchApp(t)
		if _, err := app.CancelLaunch(uuid.New()); err == nil {
			t.Fatal("wanted an error cancelling an unknown launch")
		}
		if _, err := app.GetLaunch(uuid.New()); err == nil {
			t.Fatal("wanted an error reading an unknown launch")
		}
	})

	t.Run("should interrupt pending launches before switching projects", func(t *testing.T) {
		app, events, launchpadID, origin := newLaunchApp(t)
		id, err := app.Launch(rawGet(origin, "/slow?sleep=10"), launchpadID.String(), false)
		if err != nil {
			t.Fatalf("launching: %v", err)
		}
		launchEvent(t, events, "launch-started")

		if _, err := app.OpenProject("other"); err != nil {
			t.Fatalf("switching project: %v", err)
		}
		finished := launchEvent(t, events, "launch-finished")
		if finished.ID != id || finished.Status != domain.LaunchFailed || finished.Reason != domain.LaunchReasonInterrupted {
			t.Fatalf("wanted launch %s failed interrupted\ngot: %+v", id, finished)
		}
	})

	t.Run("should interrupt pending launches when the app closes", func(t *testing.T) {
		app, events, launchpadID, origin := newLaunchApp(t)
		id, err := app.Launch(rawGet(origin, "/slow?sleep=10"), launchpadID.String(), false)
		if err != nil {
			t.Fatalf("launching: %v", err)
		}
		launchEvent(t, events, "launch-started")

		app.close(context.Background())
		finished := launchEvent(t, events, "launch-finished")
		if finished.ID != id || finished.Status != domain.LaunchFailed || finished.Reason != domain.LaunchReasonInterrupted {
			t.Fatalf("wanted launch %s failed interrupted\ngot: %+v", id, finished)
		}
	})
}

// newLaunchApp returns an app with the scratchpad open, a running listener,
// a launchpad, and an origin that answers at once or after ?sleep=<seconds>.
func newLaunchApp(t *testing.T) (*App, *recordedEvents, uuid.UUID, *url.URL) {
	t.Helper()
	app := newScratchpadApp(t)
	events := &recordedEvents{}
	app.emitEvent = events.emit
	if err := app.StartProxy("127.0.0.1", "0"); err != nil {
		t.Fatalf("starting listener: %v", err)
	}
	launchpadID := app.CreateLaunchpadEntry("launches", "")
	if launchpadID == uuid.Nil {
		t.Fatal("wanted a launchpad")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seconds, err := strconv.Atoi(r.URL.Query().Get("sleep")); err == nil {
			select {
			case <-time.After(time.Duration(seconds) * time.Second):
			case <-r.Context().Done():
				return
			}
		}
		fmt.Fprint(w, "ok")
	}))
	t.Cleanup(server.Close)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parsing origin: %v", err)
	}
	return app, events, launchpadID, origin
}

func rawGet(origin *url.URL, path string) string {
	return "GET " + path + " HTTP/1.1\r\nHost: " + origin.Host + "\r\n\r\n"
}

// launchEvent waits for the first event called name and returns its launch.
func launchEvent(t *testing.T, events *recordedEvents, name string) domain.Launch {
	t.Helper()
	data := waitForEvent(t, events, name)
	launch, ok := data[0].(domain.Launch)
	if !ok {
		t.Fatalf("wanted %s data domain.Launch\ngot: %T", name, data[0])
	}
	return launch
}
