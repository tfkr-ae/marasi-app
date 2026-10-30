package main

import (
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
)

// runPair is a pair an Armory run sent: status 0 leaves it without a
// response.
type runPair struct {
	status int
	length int
}

func captureRunPair(t *testing.T, app *App, runID uuid.UUID, pair runPair) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("creating pair id: %v", err)
	}
	err = app.Proxy.TrafficRepo.InsertRequest(&domain.ProxyRequest{
		ID: id, Scheme: "https", Method: "GET", Host: "api.acme.test", Path: "/",
		Raw: []byte("GET / HTTP/1.1\r\nHost: api.acme.test\r\n\r\n"), Metadata: map[string]any{"armory_run_id": runID},
		RequestedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("inserting request: %v", err)
	}
	if pair.status != 0 {
		err = app.Proxy.TrafficRepo.InsertResponse(&domain.ProxyResponse{
			ID: id, Status: "status", StatusCode: pair.status, ContentType: "image/png", Length: strconv.Itoa(pair.length),
			Raw: []byte("HTTP/1.1 200 OK\r\n\r\n"), Metadata: map[string]any{}, RespondedAt: time.Now(),
		})
		if err != nil {
			t.Fatalf("inserting response: %v", err)
		}
	}
	return id
}

func pageRunTraffic(t *testing.T, app *App, runID uuid.UUID, req TrafficPageRequest) TrafficQueryResult {
	t.Helper()
	result, err := app.QueryArmoryRunTraffic(runID.String(), req)
	if err != nil {
		t.Fatalf("paging run traffic %+v: %v", req, err)
	}
	if result.QueryError != nil {
		t.Fatalf("paging run traffic %+v: unexpected query error %+v", req, *result.QueryError)
	}
	return result
}

func TestQueryArmoryRunTrafficListsOnlyTheRunsPairsOldestFirst(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	first := captureRunPair(t, app, run, runPair{status: 200, length: 10})
	captureRunPair(t, app, uuid.New(), runPair{status: 200, length: 10})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/", statusCode: 200, contentType: "text/html"})
	second := captureRunPair(t, app, run, runPair{status: 404, length: 5})
	// The run's pairs show whatever their content type.
	excludeContentTypes(t, app, "image/png")

	result := pageRunTraffic(t, app, run, TrafficPageRequest{})

	assertIDs(t, []uuid.UUID{first, second}, itemIDs(result.Items))
	if result.AsOf != second.String() {
		t.Fatalf("wanted as_of %s, the run's newest pair, got %q", second, result.AsOf)
	}
}

func TestQueryArmoryRunTrafficSortsByStatusWithPendingPairsLast(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	notFound := captureRunPair(t, app, run, runPair{status: 404, length: 5})
	pending := captureRunPair(t, app, run, runPair{})
	ok := captureRunPair(t, app, run, runPair{status: 200, length: 7})
	failed := captureRunPair(t, app, run, runPair{status: 500, length: 3})

	asc := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "status_code"})
	desc := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "status_code desc"})

	assertIDs(t, []uuid.UUID{ok, notFound, failed, pending}, itemIDs(asc.Items))
	assertIDs(t, []uuid.UUID{failed, notFound, ok, pending}, itemIDs(desc.Items))
}

func TestQueryArmoryRunTrafficSortsByLengthWithPendingPairsLast(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	mid := captureRunPair(t, app, run, runPair{status: 404, length: 1245})
	pending := captureRunPair(t, app, run, runPair{})
	short := captureRunPair(t, app, run, runPair{status: 200, length: 9})
	long := captureRunPair(t, app, run, runPair{status: 404, length: 20480})

	asc := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "length"})
	desc := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "length desc"})

	assertIDs(t, []uuid.UUID{short, mid, long, pending}, itemIDs(asc.Items))
	assertIDs(t, []uuid.UUID{long, mid, short, pending}, itemIDs(desc.Items))
}

func TestQueryArmoryRunTrafficSortsNewestFirst(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	first := captureRunPair(t, app, run, runPair{status: 200, length: 1})
	second := captureRunPair(t, app, run, runPair{status: 200, length: 1})

	desc := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "requested_at desc"})

	assertIDs(t, []uuid.UUID{second, first}, itemIDs(desc.Items))
}

func TestQueryArmoryRunTrafficPagesASortUnderOneAsOf(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	lengths := []int{50, 10, 40, 20, 30}
	ids := map[int]uuid.UUID{}
	for _, length := range lengths {
		ids[length] = captureRunPair(t, app, run, runPair{status: 200, length: length})
	}

	first := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "length", Limit: 2})
	if first.NextCursor == nil {
		t.Fatalf("wanted a next cursor after the first page")
	}
	// A pair the run sends after the first page stays out of later pages.
	captureRunPair(t, app, run, runPair{status: 200, length: 35})
	second := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "length", Limit: 2, Cursor: *first.NextCursor, AsOf: first.AsOf})
	third := pageRunTraffic(t, app, run, TrafficPageRequest{OrderBy: "length", Limit: 2, Cursor: *second.NextCursor, AsOf: first.AsOf})

	assertIDs(t, []uuid.UUID{ids[10], ids[20]}, itemIDs(first.Items))
	assertIDs(t, []uuid.UUID{ids[30], ids[40]}, itemIDs(second.Items))
	assertIDs(t, []uuid.UUID{ids[50]}, itemIDs(third.Items))
	if third.NextCursor != nil {
		t.Fatalf("wanted no next cursor at the end of the snapshot, got %v", *third.NextCursor)
	}
}

func TestQueryArmoryRunTrafficNarrowsTheRunByAQuery(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	forbidden := captureRunPair(t, app, run, runPair{status: 403, length: 5})
	captureRunPair(t, app, run, runPair{status: 200, length: 5})
	captureRunPair(t, app, uuid.New(), runPair{status: 403, length: 5})
	other := captureRunPair(t, app, run, runPair{status: 403, length: 9})

	// An OR in the narrowing still stays inside the run.
	result := pageRunTraffic(t, app, run, TrafficPageRequest{Query: "status_code = 403 OR status_code = 418"})

	assertIDs(t, []uuid.UUID{forbidden, other}, itemIDs(result.Items))
}

func TestQueryArmoryRunTrafficReportsABadNarrowingAsAQueryError(t *testing.T) {
	app := newScratchpadApp(t)

	result, err := app.QueryArmoryRunTraffic(uuid.New().String(), TrafficPageRequest{Query: "status_code = "})

	if err != nil {
		t.Fatalf("wanted a query error, got Go error %v", err)
	}
	if result.QueryError == nil {
		t.Fatalf("wanted a query error for a malformed narrowing")
	}
}

func TestQueryArmoryRunTrafficRefusesABadRunID(t *testing.T) {
	app := newScratchpadApp(t)

	_, err := app.QueryArmoryRunTraffic(`x" OR host = "*`, TrafficPageRequest{})

	if err == nil {
		t.Fatalf("wanted an error for a malformed run id")
	}
}
