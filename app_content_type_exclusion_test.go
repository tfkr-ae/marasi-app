package main

import (
	"slices"
	"testing"
)

func assertStrings(t *testing.T, want, got []string) {
	t.Helper()
	if !slices.Equal(want, got) {
		t.Fatalf("\nwanted:\n%q\ngot:\n%q", want, got)
	}
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
