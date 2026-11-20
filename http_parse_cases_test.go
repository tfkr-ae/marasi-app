package main

import (
	"encoding/json"
	"os"
	"runtime/debug"
	"testing"
)

// The Checkpoint editor's malformed warning runs in the frontend
// (frontend/src/lib/checkpoint/httpParse.js), a port of how Marasi reads a
// Checkpoint edit. Its test compares the port with the answers in
// httpParse.cases.json, which scripts/record-checkpoint-parse-cases.sh
// records from the pinned marasi module. This test keeps that recording at
// the version go.mod pins.
func TestHTTPParseCasesRecordedAtPinnedMarasi(t *testing.T) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		t.Fatal("no build info")
	}
	pinned := ""
	for _, dep := range info.Deps {
		if dep.Path == "github.com/tfkr-ae/marasi" {
			pinned = dep.Version
		}
	}
	if pinned == "" {
		t.Fatal("github.com/tfkr-ae/marasi is not in the build")
	}
	data, err := os.ReadFile("frontend/src/lib/checkpoint/httpParse.cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var recorded struct {
		Marasi string `json:"marasi"`
		Cases  []struct {
			Type     string `json:"type"`
			Protocol string `json:"protocol"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &recorded); err != nil {
		t.Fatal(err)
	}
	if recorded.Marasi != pinned {
		t.Fatalf("httpParse.cases.json was recorded at marasi %q, go.mod pins %q: run scripts/record-checkpoint-parse-cases.sh and check httpParse.js against the new cases", recorded.Marasi, pinned)
	}
	if len(recorded.Cases) == 0 {
		t.Fatal("httpParse.cases.json has no cases")
	}
}
