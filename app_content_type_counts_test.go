package main

import (
	"fmt"
	"slices"
	"testing"
)

func TestCountContentTypesCountsEveryTypeIncludingInFlightPairs(t *testing.T) {
	app := newScratchpadApp(t)
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/a", statusCode: 200, contentType: "application/json"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/b", statusCode: 200, contentType: "application/json"})
	capturePair(t, app, capturedPair{host: "cdn.acme.test", path: "/c", statusCode: 200, contentType: "image/png"})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/d"})
	// Excluded types are still counted: the Types menu lists them as Hidden.
	excludeContentTypes(t, app, "image/png")

	counts, err := app.CountContentTypes()

	if err != nil {
		t.Fatalf("counting content types: %v", err)
	}
	got := make([]string, 0, len(counts))
	for _, c := range counts {
		got = append(got, fmt.Sprintf("%s=%d", c.ContentType, c.Count))
	}
	want := []string{"application/json=2", "=1", "image/png=1"}
	if !slices.Equal(got, want) {
		t.Fatalf("wanted %v, got %v", want, got)
	}
}

func TestCountContentTypesReturnsGoErrorWithoutAProject(t *testing.T) {
	app := newProjectApp(t)

	_, err := app.CountContentTypes()

	if err == nil {
		t.Fatalf("wanted an error when no project is open")
	}
}
