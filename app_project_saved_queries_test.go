package main

import (
	"encoding/json"
	"testing"
)

// Project saved queries are marasi-app client settings
// `ledger.saved_query.<uuid>` (docs/adr/2026-10-16-app-defaults-with-project-overrides.md): they stay in their project file.
func TestProjectSavedQueriesStayWithTheirProject(t *testing.T) {
	app := newScratchpadApp(t)
	value := json.RawMessage(`{"name":"Login","query":"path = \"/login\"","order":0}`)
	if _, err := app.SetClientSetting("ledger.saved_query.p1", value); err != nil {
		t.Fatalf("saving: %v", err)
	}

	openTestProject(t, app, "other")
	listed, err := app.ListClientSettings("ledger.saved_query.")
	if err != nil || len(listed) != 0 {
		t.Fatalf("wanted no saved queries in the other project, got %+v, %v", listed, err)
	}

	openTestProject(t, app, scratchpadPath(t, app))
	listed, err = app.ListClientSettings("ledger.saved_query.")
	if err != nil || len(listed) != 1 || listed[0].Key != "ledger.saved_query.p1" {
		t.Fatalf("wanted the scratchpad's saved query back, got %+v, %v", listed, err)
	}
	var got struct {
		Name, Query string
		Order       int
	}
	if err := json.Unmarshal(listed[0].Value, &got); err != nil || got.Name != "Login" || got.Query != `path = "/login"` {
		t.Fatalf("wanted the stored name and query, got %+v, %v", got, err)
	}
}
