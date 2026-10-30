package main

import (
	"fmt"
	"slices"
	"testing"

	"github.com/google/uuid"
)

func countLabels(counts ArmoryRunTrafficCounts) []string {
	got := make([]string, 0, len(counts.Counts))
	for _, c := range counts.Counts {
		got = append(got, fmt.Sprintf("%s=%d", c.Value, c.Count))
	}
	return got
}

func TestCountArmoryRunTrafficCountsTheRunsPairsByStatusIncludingPendingPairs(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	captureRunPair(t, app, run, runPair{status: 404, length: 5})
	captureRunPair(t, app, run, runPair{status: 404, length: 9})
	captureRunPair(t, app, run, runPair{status: 404, length: 5})
	captureRunPair(t, app, run, runPair{status: 500, length: 3})
	captureRunPair(t, app, run, runPair{})
	captureRunPair(t, app, uuid.New(), runPair{status: 200, length: 5})
	capturePair(t, app, capturedPair{host: "api.acme.test", path: "/", statusCode: 200, contentType: "text/html"})
	// The run's pairs count whatever their content type.
	excludeContentTypes(t, app, "image/png")

	counts, err := app.CountArmoryRunTraffic(run.String(), "status_code", "")

	if err != nil {
		t.Fatalf("counting run traffic: %v", err)
	}
	want := []string{"404=3", "500=1", "=1"}
	if got := countLabels(counts); !slices.Equal(got, want) {
		t.Fatalf("wanted %v, got %v", want, got)
	}
}

func TestCountArmoryRunTrafficCountsTheRunsPairsByLength(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	captureRunPair(t, app, run, runPair{status: 404, length: 1245})
	captureRunPair(t, app, run, runPair{status: 403, length: 1245})
	captureRunPair(t, app, run, runPair{status: 404, length: 1251})
	captureRunPair(t, app, run, runPair{})

	counts, err := app.CountArmoryRunTraffic(run.String(), "length", "")

	if err != nil {
		t.Fatalf("counting run traffic: %v", err)
	}
	want := []string{"1245=2", "1251=1", "=1"}
	if got := countLabels(counts); !slices.Equal(got, want) {
		t.Fatalf("wanted %v, got %v", want, got)
	}
}

func TestCountArmoryRunTrafficCountsNothingForARunWithNoPairs(t *testing.T) {
	app := newScratchpadApp(t)

	counts, err := app.CountArmoryRunTraffic(uuid.New().String(), "status_code", "")

	if err != nil {
		t.Fatalf("counting run traffic: %v", err)
	}
	if len(counts.Counts) != 0 {
		t.Fatalf("wanted no counts, got %v", countLabels(counts))
	}
}

func TestCountArmoryRunTrafficCountsUnderTheAsOfItReports(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	captureRunPair(t, app, run, runPair{status: 404, length: 5})
	newest := captureRunPair(t, app, run, runPair{status: 404, length: 5})

	first, err := app.CountArmoryRunTraffic(run.String(), "status_code", "")
	if err != nil {
		t.Fatalf("counting run traffic: %v", err)
	}
	captureRunPair(t, app, run, runPair{status: 404, length: 5})
	captureRunPair(t, app, run, runPair{status: 500, length: 3})
	again, err := app.CountArmoryRunTraffic(run.String(), "status_code", first.AsOf)
	if err != nil {
		t.Fatalf("counting run traffic: %v", err)
	}

	if first.AsOf != newest.String() {
		t.Fatalf("wanted the count's as_of to be the newest pair %s, got %q", newest, first.AsOf)
	}
	if again.AsOf != first.AsOf {
		t.Fatalf("wanted the as_of passed back, got %q", again.AsOf)
	}
	// Pairs captured after the as_of are left out.
	want := []string{"404=2"}
	if got := countLabels(again); !slices.Equal(got, want) {
		t.Fatalf("wanted %v, got %v", want, got)
	}
}

func TestCountArmoryRunTrafficRefusesABadAsOf(t *testing.T) {
	app := newScratchpadApp(t)

	_, err := app.CountArmoryRunTraffic(uuid.New().String(), "status_code", "latest")

	if err == nil {
		t.Fatalf("wanted an error for a malformed as_of")
	}
}

func TestCountArmoryRunTrafficRefusesABadRunID(t *testing.T) {
	app := newScratchpadApp(t)

	_, err := app.CountArmoryRunTraffic(`x" OR host = "*`, "status_code", "")

	if err == nil {
		t.Fatalf("wanted an error for a malformed run id")
	}
}

func TestCountArmoryRunTrafficRefusesAFieldItCannotCountBy(t *testing.T) {
	app := newScratchpadApp(t)

	_, err := app.CountArmoryRunTraffic(uuid.New().String(), "host", "")

	if err == nil {
		t.Fatalf("wanted an error for a field it cannot count by")
	}
}

func TestQueryArmoryRunTrafficReadsTheGroupOfPendingPairs(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	captureRunPair(t, app, run, runPair{status: 502, length: 0})
	pending := captureRunPair(t, app, run, runPair{})
	captureRunPair(t, app, run, runPair{status: 200, length: 7})

	// The store names the "" group of a count as NOT field >= 0.
	byStatus := pageRunTraffic(t, app, run, TrafficPageRequest{Query: "NOT status_code >= 0"})
	byLength := pageRunTraffic(t, app, run, TrafficPageRequest{Query: "NOT length >= 0"})

	assertIDs(t, []uuid.UUID{pending}, itemIDs(byStatus.Items))
	assertIDs(t, []uuid.UUID{pending}, itemIDs(byLength.Items))
}

func TestQueryArmoryRunTrafficPagesOneGroupSortedUnderOneAsOf(t *testing.T) {
	app := newScratchpadApp(t)
	run := uuid.New()
	ids := map[int]uuid.UUID{}
	for _, length := range []int{30, 10, 40, 20} {
		ids[length] = captureRunPair(t, app, run, runPair{status: 404, length: length})
	}
	captureRunPair(t, app, run, runPair{status: 200, length: 25})
	group := TrafficPageRequest{Query: "status_code = 404", OrderBy: "length desc", Limit: 2}

	first := pageRunTraffic(t, app, run, group)
	captureRunPair(t, app, run, runPair{status: 404, length: 50})
	group.Cursor, group.AsOf = *first.NextCursor, first.AsOf
	second := pageRunTraffic(t, app, run, group)

	assertIDs(t, []uuid.UUID{ids[40], ids[30]}, itemIDs(first.Items))
	assertIDs(t, []uuid.UUID{ids[20], ids[10]}, itemIDs(second.Items))
	if second.NextCursor != nil {
		t.Fatalf("wanted the group to end under its as_of, got next cursor %v", *second.NextCursor)
	}
}
