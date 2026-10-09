package main

import (
	"database/sql"
	"io"
	"log/slog"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/db"
	"github.com/tfkr-ae/marasi/domain"
)

type capturedPair struct {
	host        string
	path        string
	statusCode  int // 0 leaves the pair in flight, without a response
	contentType string
	body        string
}

func capturePair(t *testing.T, app *App, pair capturedPair) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("creating pair id: %v", err)
	}
	raw := "GET " + pair.path + " HTTP/1.1\r\nHost: " + pair.host + "\r\n\r\n"
	err = app.Proxy.TrafficRepo.InsertRequest(&domain.ProxyRequest{
		ID: id, Scheme: "https", Method: "GET", Host: pair.host, Path: pair.path,
		Raw: []byte(raw), Metadata: map[string]any{}, RequestedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("inserting request: %v", err)
	}
	if pair.statusCode != 0 {
		err = app.Proxy.TrafficRepo.InsertResponse(&domain.ProxyResponse{
			ID: id, Status: "status", StatusCode: pair.statusCode, ContentType: pair.contentType, Length: "0",
			Raw:      []byte("HTTP/1.1 200 OK\r\nContent-Type: " + pair.contentType + "\r\n\r\n" + pair.body),
			Metadata: map[string]any{}, RespondedAt: time.Now(),
		})
		if err != nil {
			t.Fatalf("inserting response: %v", err)
		}
	}
	return id
}

func itemIDs(items []*domain.RequestResponseSummary) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}

func queryTraffic(t *testing.T, app *App, query string, cursor *uuid.UUID) TrafficQueryResult {
	t.Helper()
	result, err := app.QueryTraffic(query, cursor)
	if err != nil {
		t.Fatalf("querying %q: %v", query, err)
	}
	if result.QueryError != nil {
		t.Fatalf("querying %q: unexpected query error %+v", query, *result.QueryError)
	}
	return result
}

func assertIDs(t *testing.T, want, got []uuid.UUID) {
	t.Helper()
	if !slices.Equal(want, got) {
		t.Fatalf("\nwanted:\n%v\ngot:\n%v", want, got)
	}
}

func TestQueryTrafficMatchesBareTextNewestFirst(t *testing.T) {
	app := newScratchpadApp(t)
	older := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "application/json", body: `{"token":"eyJhbGciOi"}`})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "application/json", body: `{"ok":true}`})
	newer := capturePair(t, app, capturedPair{host: "www.acme.test", path: "/c", statusCode: 200, contentType: "text/html", body: "<p>eyJhbGciOi</p>"})

	result := queryTraffic(t, app, "eyJhbGci", nil)

	assertIDs(t, []uuid.UUID{newer, older}, itemIDs(result.Items))
	if result.NextCursor != nil {
		t.Fatalf("wanted no next cursor, got %v", *result.NextCursor)
	}
}

func TestQueryTrafficMatchesFieldExpressionNewestFirst(t *testing.T) {
	app := newScratchpadApp(t)
	older := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 500, contentType: "application/json"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "application/json"})
	capturePair(t, app, capturedPair{host: "www.acme.test", path: "/c", statusCode: 502, contentType: "text/html"})
	newer := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/d", statusCode: 503, contentType: "application/json"})

	result := queryTraffic(t, app, `status_code >= 500 AND host = "api.acme.test"`, nil)

	assertIDs(t, []uuid.UUID{newer, older}, itemIDs(result.Items))
}

func excludeContentTypes(t *testing.T, app *App, contentTypes ...string) {
	t.Helper()
	if err := app.SetFilters(contentTypes); err != nil {
		t.Fatalf("storing content-type exclusion: %v", err)
	}
}

func TestQueryTrafficAppliesStoredContentTypeExclusion(t *testing.T) {
	app := newScratchpadApp(t)
	json := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "application/json"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "text/html"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/c", statusCode: 200, contentType: "image/png"})
	excludeContentTypes(t, app, "text/html", "image/png")

	result := queryTraffic(t, app, `host = "api.acme.test"`, nil)

	assertIDs(t, []uuid.UUID{json}, itemIDs(result.Items))
}

func TestQueryTrafficKeepsInFlightPairsUnderExclusion(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html"})
	inFlight := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b"})
	excludeContentTypes(t, app, "text/html")

	result := queryTraffic(t, app, `host = "api.acme.test"`, nil)

	assertIDs(t, []uuid.UUID{inFlight}, itemIDs(result.Items))
}

func TestQueryTrafficExcludesContentTypesContainingQuotesAndBackslashes(t *testing.T) {
	app := newScratchpadApp(t)
	kept := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/plain"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: `we"ird\ct`})
	excludeContentTypes(t, app, `we"ird\ct`)

	result := queryTraffic(t, app, `host = "api.acme.test"`, nil)

	assertIDs(t, []uuid.UUID{kept}, itemIDs(result.Items))
}

// The live view's exclusion matches content types exactly, so a stored value
// with a * at either end excludes only that literal value, not a wildcard.
func TestQueryTrafficExcludesContentTypesWithStarsExactly(t *testing.T) {
	app := newScratchpadApp(t)
	html := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "text/*"})
	json := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/c", statusCode: 200, contentType: "application/json"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/d", statusCode: 200, contentType: "*/*"})
	excludeContentTypes(t, app, "text/*", "*/*")

	result := queryTraffic(t, app, `host = "api.acme.test"`, nil)

	assertIDs(t, []uuid.UUID{json, html}, itemIDs(result.Items))
}

func TestQueryTrafficPagesWithCursorWithoutDuplicatesOrGaps(t *testing.T) {
	app := newScratchpadApp(t)
	var matching []uuid.UUID
	for i := range 503 {
		matching = append(matching, capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "application/json"}))
		if i%100 == 0 {
			capturePair(t, app, capturedPair{host: "www.acme.test", path: "/b", statusCode: 200, contentType: "application/json"})
		}
	}
	slices.Reverse(matching)

	first := queryTraffic(t, app, `host = "api.acme.test"`, nil)
	if first.NextCursor == nil {
		t.Fatalf("wanted a next cursor after the first page of %d items", len(first.Items))
	}
	second := queryTraffic(t, app, `host = "api.acme.test"`, first.NextCursor)

	assertIDs(t, matching, append(itemIDs(first.Items), itemIDs(second.Items)...))
	if second.NextCursor != nil {
		t.Fatalf("wanted no cursor after the last page, got %v", *second.NextCursor)
	}
}

// Values with a * are excluded after marasi returns the page, so a page can
// come back empty while older pages remain. The cursor must still lead on.
func TestQueryTrafficKeepsCursorWhenStarExclusionEmptiesAPage(t *testing.T) {
	app := newScratchpadApp(t)
	older := capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "application/json"})
	for range 501 {
		capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "*/*"})
	}
	excludeContentTypes(t, app, "*/*")

	first := queryTraffic(t, app, `host = "api.acme.test"`, nil)
	if len(first.Items) != 0 || first.NextCursor == nil {
		t.Fatalf("wanted an empty first page with a cursor, got %d items and cursor %v", len(first.Items), first.NextCursor)
	}
	second := queryTraffic(t, app, `host = "api.acme.test"`, first.NextCursor)

	assertIDs(t, []uuid.UUID{older}, itemIDs(second.Items))
	if second.NextCursor != nil {
		t.Fatalf("wanted no cursor after the last page, got %v", *second.NextCursor)
	}
}

func TestQueryTrafficReportsCompleteIndex(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html"})

	result := queryTraffic(t, app, `host = "api.acme.test"`, nil)

	if !result.IndexComplete {
		t.Fatalf("wanted IndexComplete for a project whose pairs are all indexed")
	}
}

// projectDatabase is the part of an open project database the tests touch.
type projectDatabase interface {
	Exec(query string, args ...any) (sql.Result, error)
	Close() error
}

// newTrafficApp opens a fresh project database as the project, without
// building its index, and returns the database too.
func newTrafficApp(t *testing.T) (*App, projectDatabase) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	database, err := db.New(filepath.Join(t.TempDir(), "project.marasi"), logger)
	if err != nil {
		t.Fatalf("opening project: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	proxy, err := marasi.New(
		marasi.WithLogger(logger),
		marasi.WithConfigDir(t.TempDir()),
		marasi.WithDefaultRepositories(db.NewProxyRepo(database)),
	)
	if err != nil {
		t.Fatalf("creating proxy: %v", err)
	}
	return &App{Proxy: proxy}, database
}

// newLegacyTrafficApp opens a project holding a pair written the way an older
// Marasi binary wrote it, without an index row, and never builds the index.
func newLegacyTrafficApp(t *testing.T) *App {
	t.Helper()
	app, database := newTrafficApp(t)
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("creating pair id: %v", err)
	}
	_, err = database.Exec(`INSERT INTO request
		(id, scheme, method, host, path, request_raw, response_raw, status, status_code, metadata, requested_at, responded_at)
		VALUES (?, 'https', 'GET', 'api.acme.test', '/', 'GET / HTTP/1.1', 'HTTP/1.1 200 OK', '200 OK', 200, '{}', ?, ?)`,
		id, time.Now(), time.Now())
	if err != nil {
		t.Fatalf("inserting legacy pair: %v", err)
	}
	return app
}

func TestQueryTrafficReportsIncompleteIndex(t *testing.T) {
	app := newLegacyTrafficApp(t)

	result := queryTraffic(t, app, `host = "api.acme.test"`, nil)

	if result.IndexComplete {
		t.Fatalf("wanted IndexComplete false while a pair has no index row")
	}
}

func TestQueryTrafficReturnsGoErrorWithoutAProject(t *testing.T) {
	app := newProjectApp(t)

	_, err := app.QueryTraffic(`host = "api.acme.test"`, nil)

	if err == nil {
		t.Fatalf("wanted an error when no project is open")
	}
}

func queryTrafficError(t *testing.T, app *App, query string) TrafficQueryError {
	t.Helper()
	result, err := app.QueryTraffic(query, nil)
	if err != nil {
		t.Fatalf("querying %q: wanted a query error, got Go error %v", query, err)
	}
	if result.QueryError == nil {
		t.Fatalf("querying %q: wanted a query error, got %d items", query, len(result.Items))
	}
	return *result.QueryError
}

func TestQueryTrafficReportsInvalidQueryAtResearchersPosition(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html"})

	got := queryTrafficError(t, app, "  status_code >> 5")

	want := TrafficQueryError{Message: `unexpected ">"`, Position: 16}
	if got != want {
		t.Fatalf("\nwanted:\n%+v\ngot:\n%+v", want, got)
	}
}

func TestQueryTrafficReportsInvalidQueryAtResearchersPositionUnderExclusion(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html"})
	excludeContentTypes(t, app, "image/png")

	got := queryTrafficError(t, app, "  status_code >> 5")

	want := TrafficQueryError{Message: `unexpected ">"`, Position: 16}
	if got != want {
		t.Fatalf("\nwanted:\n%+v\ngot:\n%+v", want, got)
	}
}

func TestQueryTrafficRejectsUnbalancedParenthesesUnderExclusion(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html", body: "alpha"})
	excludeContentTypes(t, app, "image/png")

	got := queryTrafficError(t, app, "alpha) OR (bravo")

	want := TrafficQueryError{Message: `unexpected ")"`, Position: 6}
	if got != want {
		t.Fatalf("\nwanted:\n%+v\ngot:\n%+v", want, got)
	}
}

// The researcher's query can be valid on its own and still fail once it is
// combined with the content-type exclusion, for example by nesting too deeply.
// The error must point into the researcher's text, not the combined query.
func TestQueryTrafficReportsCombinedQueryErrorAtResearchersPosition(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html", body: "abc"})
	excludeContentTypes(t, app, "image/png")

	got := queryTrafficError(t, app, strings.Repeat(`NOT (`, 199)+`"abc"`+strings.Repeat(`)`, 199))

	want := TrafficQueryError{Message: `query nests more than 200 conditions; use fewer conditions or less nesting`, Position: 996}
	if got != want {
		t.Fatalf("\nwanted:\n%+v\ngot:\n%+v", want, got)
	}
}

func TestQueryTrafficKeepsCombinedQueryErrorInsideResearchersText(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "text/html", body: "abc"})
	excludeContentTypes(t, app, "image/png", "image/gif")
	for _, query := range []string{
		strings.Repeat(`"abc" AND `, 199) + `"abc"`,
		`host = "` + strings.Repeat("a", 8170) + `"`,
	} {
		got := queryTrafficError(t, app, query)

		if got.Position < 1 || got.Position > len(query) {
			t.Fatalf("wanted a position inside the %d-character query, got %+v", len(query), got)
		}
	}
}

func TestQueryTrafficReturnsGoErrorWhenTheDatabaseFails(t *testing.T) {
	app, database := newTrafficApp(t)
	database.Close()

	result, err := app.QueryTraffic(`host = "api.acme.test"`, nil)

	if err == nil {
		t.Fatalf("wanted a Go error from a closed database, got %+v", result)
	}
	if result.QueryError != nil {
		t.Fatalf("wanted no query error from a closed database, got %+v", *result.QueryError)
	}
}
