package main

import (
	"testing"

	"github.com/google/uuid"
)

func pageTraffic(t *testing.T, app *App, req TrafficPageRequest) TrafficQueryResult {
	t.Helper()
	result, err := app.QueryTraffic(req)
	if err != nil {
		t.Fatalf("paging %+v: %v", req, err)
	}
	if result.QueryError != nil {
		t.Fatalf("paging %+v: unexpected query error %+v", req, *result.QueryError)
	}
	return result
}

func TestQueryTrafficSortsByTheRequestedField(t *testing.T) {
	app := newScratchpadApp(t)
	b := capturePair(t, app, capturedPair{host: "b.acme.test", path: "/", statusCode: 200, contentType: "text/html"})
	c := capturePair(t, app, capturedPair{host: "c.acme.test", path: "/", statusCode: 200, contentType: "text/html"})
	a := capturePair(t, app, capturedPair{host: "a.acme.test", path: "/", statusCode: 200, contentType: "text/html"})

	asc := pageTraffic(t, app, TrafficPageRequest{OrderBy: "host"})
	desc := pageTraffic(t, app, TrafficPageRequest{OrderBy: "host desc"})

	assertIDs(t, []uuid.UUID{a, b, c}, itemIDs(asc.Items))
	assertIDs(t, []uuid.UUID{c, b, a}, itemIDs(desc.Items))
}

func TestQueryTrafficPagesBothWaysUnderOneAsOf(t *testing.T) {
	app := newScratchpadApp(t)
	var ids []uuid.UUID
	for range 5 {
		ids = append(ids, capturePair(t, app, capturedPair{host: "api.acme.test", path: "/", statusCode: 200, contentType: "text/html"}))
	}

	first := pageTraffic(t, app, TrafficPageRequest{OrderBy: "requested_at", Limit: 2})
	if first.AsOf != ids[4].String() {
		t.Fatalf("wanted as_of %s, the newest pair, got %q", ids[4], first.AsOf)
	}
	if first.PrevCursor != nil || first.NextCursor == nil {
		t.Fatalf("wanted only a next cursor on the first page, got prev %v next %v", first.PrevCursor, first.NextCursor)
	}
	// A pair captured after the first page stays out of later pages.
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/", statusCode: 200, contentType: "text/html"})

	second := pageTraffic(t, app, TrafficPageRequest{OrderBy: "requested_at", Cursor: *first.NextCursor, AsOf: first.AsOf, Limit: 2})
	third := pageTraffic(t, app, TrafficPageRequest{OrderBy: "requested_at", Cursor: *second.NextCursor, AsOf: first.AsOf, Limit: 2})
	assertIDs(t, ids[2:4], itemIDs(second.Items))
	assertIDs(t, ids[4:], itemIDs(third.Items))
	if third.NextCursor != nil {
		t.Fatalf("wanted no next cursor at the end of the snapshot, got %v", *third.NextCursor)
	}

	back := pageTraffic(t, app, TrafficPageRequest{OrderBy: "requested_at", Cursor: *third.PrevCursor, Direction: "backward", AsOf: first.AsOf, Limit: 2})
	assertIDs(t, ids[2:4], itemIDs(back.Items))
	if back.PrevCursor == nil || back.NextCursor == nil {
		t.Fatalf("wanted both cursors on a middle page, got prev %v next %v", back.PrevCursor, back.NextCursor)
	}
}

func TestQueryTrafficCanIgnoreTheExclusion(t *testing.T) {
	app := newScratchpadApp(t)
	json := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "application/json"})
	png := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "image/png"})
	excludeContentTypes(t, app, "image/png")

	result := pageTraffic(t, app, TrafficPageRequest{IgnoreExclusion: true})

	assertIDs(t, []uuid.UUID{png, json}, itemIDs(result.Items))
}

// The finding and test case request pickers search with this query shape
// (frontend/src/lib/requestPicker.js).
func TestQueryTrafficMatchesTextAnywhereInHostOrPath(t *testing.T) {
	app := newScratchpadApp(t)
	inHost := capturePair(t, app, capturedPair{host: "login.acme.test", path: "/", statusCode: 200, contentType: "text/html"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/users", statusCode: 200, contentType: "text/html"})
	inPath := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/v1/login/start", statusCode: 200, contentType: "text/html"})

	result := pageTraffic(t, app, TrafficPageRequest{Query: `host = "*login*" OR path = "*login*"`})

	assertIDs(t, []uuid.UUID{inPath, inHost}, itemIDs(result.Items))
}

func TestQueryTrafficSortsAPendingPairLastBothWays(t *testing.T) {
	app := newScratchpadApp(t)
	ok := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html"})
	pending := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b"})
	failed := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/c", statusCode: 500, contentType: "text/html"})

	asc := pageTraffic(t, app, TrafficPageRequest{OrderBy: "status_code"})
	desc := pageTraffic(t, app, TrafficPageRequest{OrderBy: "status_code desc"})

	assertIDs(t, []uuid.UUID{ok, failed, pending}, itemIDs(asc.Items))
	assertIDs(t, []uuid.UUID{failed, ok, pending}, itemIDs(desc.Items))
}

func TestQueryTrafficReportsAnInvalidSortAsAQueryError(t *testing.T) {
	app := newScratchpadApp(t)

	result, err := app.QueryTraffic(TrafficPageRequest{OrderBy: "duration"})

	if err != nil {
		t.Fatalf("wanted a query error, got Go error %v", err)
	}
	if result.QueryError == nil {
		t.Fatalf("wanted a query error for an unknown sort field")
	}
}

func TestQueryTrafficRejectsACursorFromAnotherSort(t *testing.T) {
	app := newScratchpadApp(t)
	for range 3 {
		capturePair(t, app, capturedPair{host: "api.acme.test", path: "/", statusCode: 200, contentType: "text/html"})
	}
	first := pageTraffic(t, app, TrafficPageRequest{OrderBy: "host", Limit: 1})

	_, err := app.QueryTraffic(TrafficPageRequest{OrderBy: "path", Cursor: *first.NextCursor, Limit: 1})

	if err == nil {
		t.Fatalf("wanted an error for a cursor made under another sort")
	}
}

func TestQueryTrafficRejectsAMalformedAsOf(t *testing.T) {
	app := newScratchpadApp(t)

	_, err := app.QueryTraffic(TrafficPageRequest{AsOf: "not-a-uuid"})

	if err == nil {
		t.Fatalf("wanted an error for a malformed as_of")
	}
}

func TestCountNotesCountsEveryRequest(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "image/png"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b"})
	excludeContentTypes(t, app, "image/png")

	dashboard, err := app.CountNotes()

	if err != nil {
		t.Fatalf("counting: %v", err)
	}
	if dashboard.Requests != 2 {
		t.Fatalf("wanted 2 requests, got %d", dashboard.Requests)
	}
	if !dashboard.InterceptionsComplete {
		t.Fatalf("wanted a new project's intercepted count to be complete")
	}
}
