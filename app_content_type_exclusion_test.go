package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/db"
)

func projectExclusion(t *testing.T, app *App) []string {
	t.Helper()
	exclusion, err := app.GetContentTypeExclusion()
	if err != nil {
		t.Fatalf("reading content-type exclusion: %v", err)
	}
	return exclusion
}

func assertStrings(t *testing.T, want, got []string) {
	t.Helper()
	if !slices.Equal(want, got) {
		t.Fatalf("\nwanted:\n%q\ngot:\n%q", want, got)
	}
}

func TestNewProjectFollowsTheSeededAppDefaultExclusion(t *testing.T) {
	app := newScratchpadApp(t)

	got := projectExclusion(t, app)

	if !slices.Contains(got, "image/png") || !slices.Contains(got, "font/woff2") || !slices.Contains(got, "text/css") {
		t.Fatalf("wanted the seeded default exclusion, got %q", got)
	}
	if slices.Contains(got, "text/html") || slices.Contains(got, "application/json") {
		t.Fatalf("wanted pages and API responses visible by default, got %q", got)
	}
}

func TestQueryTrafficHidesTheAppDefaultExclusion(t *testing.T) {
	app := newScratchpadApp(t)
	page := capturePair(t, app, capturedPair{host: "a.test", path: "/", statusCode: 200, contentType: "text/html"})
	capturePair(t, app, capturedPair{host: "a.test", path: "/logo.png", statusCode: 200, contentType: "image/png"})

	result := queryTraffic(t, app, "", "")

	assertIDs(t, []uuid.UUID{page}, itemIDs(result.Items))
}

func TestProjectExclusionOverridesTheAppDefault(t *testing.T) {
	app := newScratchpadApp(t)
	png := capturePair(t, app, capturedPair{host: "a.test", path: "/logo.png", statusCode: 200, contentType: "image/png"})
	capturePair(t, app, capturedPair{host: "a.test", path: "/", statusCode: 200, contentType: "text/html"})

	if err := app.SetContentTypeExclusion([]string{"text/html"}); err != nil {
		t.Fatalf("setting project exclusion: %v", err)
	}

	assertStrings(t, []string{"text/html"}, projectExclusion(t, app))
	assertIDs(t, []uuid.UUID{png}, itemIDs(queryTraffic(t, app, "", "").Items))
	setting, err := app.GetClientSetting(ledgerExclusionKey)
	if err != nil || setting == nil {
		t.Fatalf("wanted the project list in %s, got %v, %v", ledgerExclusionKey, setting, err)
	}
}

func TestProjectExclusionCanBeEmpty(t *testing.T) {
	app := newScratchpadApp(t)

	if err := app.SetContentTypeExclusion([]string{}); err != nil {
		t.Fatalf("setting project exclusion: %v", err)
	}

	assertStrings(t, []string{}, projectExclusion(t, app))
}

func TestSetContentTypeExclusionRejectsAnInvalidValue(t *testing.T) {
	app := newScratchpadApp(t)

	if err := app.SetContentTypeExclusion([]string{"text/*/x*"}); err == nil {
		t.Fatalf("wanted an error for an invalid content type")
	}
}

func TestResetContentTypeExclusionFollowsTheAppDefaultAgain(t *testing.T) {
	app := newScratchpadApp(t)
	defaults := projectExclusion(t, app)
	if err := app.SetContentTypeExclusion([]string{"text/html"}); err != nil {
		t.Fatalf("setting project exclusion: %v", err)
	}

	if err := app.ResetContentTypeExclusion(); err != nil {
		t.Fatalf("resetting project exclusion: %v", err)
	}

	assertStrings(t, defaults, projectExclusion(t, app))
	if err := app.SetDefaultContentTypeExclusion([]string{"text/plain"}); err != nil {
		t.Fatalf("setting app default: %v", err)
	}
	assertStrings(t, []string{"text/plain"}, projectExclusion(t, app))
}

func TestHasOwnContentTypeExclusionTellsWhetherTheProjectKeepsItsOwnList(t *testing.T) {
	app := newScratchpadApp(t)
	hasOwn := func() bool {
		t.Helper()
		own, err := app.HasOwnContentTypeExclusion()
		if err != nil {
			t.Fatalf("reading whether the project has its own exclusion: %v", err)
		}
		return own
	}
	if hasOwn() {
		t.Fatal("wanted a new project to follow the app default")
	}
	if err := app.SetContentTypeExclusion([]string{}); err != nil {
		t.Fatalf("setting project exclusion: %v", err)
	}
	if !hasOwn() {
		t.Fatal("wanted an edited project, even with an empty list, to keep its own")
	}
	if err := app.ResetContentTypeExclusion(); err != nil {
		t.Fatalf("resetting project exclusion: %v", err)
	}
	if hasOwn() {
		t.Fatal("wanted a reset project to follow the app default again")
	}
}

func TestQueryTrafficExcludesAWholeMajorType(t *testing.T) {
	app := newScratchpadApp(t)
	page := capturePair(t, app, capturedPair{host: "a.test", path: "/", statusCode: 200, contentType: "text/html"})
	capturePair(t, app, capturedPair{host: "a.test", path: "/a.webp", statusCode: 200, contentType: "image/webp"})
	capturePair(t, app, capturedPair{host: "a.test", path: "/b.x", statusCode: 200, contentType: "image/x-made-up"})

	excludeContentTypes(t, app, "image/*")

	assertIDs(t, []uuid.UUID{page}, itemIDs(queryTraffic(t, app, "", "").Items))
}

func TestAppDefaultExclusionPersistsInTheAppConfig(t *testing.T) {
	dir := t.TempDir()
	app := loadConfigApp(t, dir)

	if err := app.SetDefaultContentTypeExclusion([]string{"Image/PNG", "font/*"}); err != nil {
		t.Fatalf("setting app default: %v", err)
	}

	assertStrings(t, []string{"image/png", "font/*"}, app.GetDefaultContentTypeExclusion())
	assertStrings(t, []string{"image/png", "font/*"}, loadConfigApp(t, dir).GetDefaultContentTypeExclusion())
}

func TestAnUnreadableAppDefaultExclusionFallsBackToTheSeededList(t *testing.T) {
	dir := t.TempDir()
	writeAppConfig(t, dir, "ledger_content_type_exclusion: not-a-list\n")

	got := loadConfigApp(t, dir).GetDefaultContentTypeExclusion()

	assertStrings(t, seededContentTypeExclusion, got)
}

// legacyProject writes a project file holding the exclusion the way Marasi's
// migration 00012 moved an edited app.filters.
func legacyProject(t *testing.T, dir string, legacyValue string) string {
	t.Helper()
	path := filepath.Join(dir, "legacy.marasi")
	database, err := db.New(path, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("creating project: %v", err)
	}
	_, err = database.Exec(`INSERT INTO client_setting (client, key, value, updated_at) VALUES ('marasi', 'legacy.content_type_exclusion', ?, ?)`, legacyValue, time.Now().UTC())
	if err != nil {
		t.Fatalf("writing legacy exclusion: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("closing project: %v", err)
	}
	return path
}

func TestOpeningAProjectMigratesItsLegacyExclusion(t *testing.T) {
	app := newProjectApp(t)
	path := legacyProject(t, t.TempDir(), `["text/html","image/png"]`)

	openTestProject(t, app, path)

	assertStrings(t, []string{"text/html", "image/png"}, projectExclusion(t, app))
	configRepo, err := app.Proxy.GetConfigRepo()
	if err != nil {
		t.Fatalf("reading config repo: %v", err)
	}
	legacy, err := configRepo.ListClientSettings("marasi", "legacy.")
	if err != nil || len(legacy) != 0 {
		t.Fatalf("wanted the marasi key deleted, got %v, %v", legacy, err)
	}
}

func TestClientSettingsRoundTripForTheApp(t *testing.T) {
	app := newScratchpadApp(t)

	missing, err := app.GetClientSetting("ledger.saved_query.x")
	if err != nil || missing != nil {
		t.Fatalf("wanted no setting and no error, got %v, %v", missing, err)
	}
	if _, err := app.SetClientSetting("ledger.highlight.1", json.RawMessage(`{"label":"Auth"}`)); err != nil {
		t.Fatalf("setting: %v", err)
	}
	if _, err := app.SetClientSetting("ledger.highlight.2", json.RawMessage(`{"label":"IDOR"}`)); err != nil {
		t.Fatalf("setting: %v", err)
	}
	got, err := app.GetClientSetting("ledger.highlight.1")
	if err != nil || got == nil || got.Client != "marasi-app" || string(got.Value) != `{"label":"Auth"}` {
		t.Fatalf("wanted the stored marasi-app setting, got %+v, %v", got, err)
	}
	listed, err := app.ListClientSettings("ledger.highlight.")
	if err != nil || len(listed) != 2 {
		t.Fatalf("wanted 2 highlight settings, got %+v, %v", listed, err)
	}
	if err := app.DeleteClientSetting("ledger.highlight.1"); err != nil {
		t.Fatalf("deleting: %v", err)
	}
	listed, err = app.ListClientSettings("ledger.")
	if err != nil || len(listed) != 1 || listed[0].Key != "ledger.highlight.2" {
		t.Fatalf("wanted only ledger.highlight.2 left, got %+v, %v", listed, err)
	}
}
