package main

import (
	"encoding/json"
	"os"
	"runtime/debug"
	"testing"
)

// The Lua editor's autocomplete is checked against the Lua API recorded from
// the pinned Marasi (frontend/src/lib/autocomplete/definitions.test.js).
// This test fails when the pin moves without a new recording.
func TestLuaReferenceRecordedAtPinnedMarasi(t *testing.T) {
	data, err := os.ReadFile("frontend/src/lib/autocomplete/marasiLuaReference.json")
	if err != nil {
		t.Fatal(err)
	}
	var recorded struct {
		Marasi string `json:"marasi"`
	}
	if err := json.Unmarshal(data, &recorded); err != nil {
		t.Fatal(err)
	}
	if pinned := pinnedMarasiForLuaReference(t); recorded.Marasi != pinned {
		t.Errorf("marasiLuaReference.json was recorded at marasi %s, go.mod pins %s: run scripts/record-lua-reference.sh", recorded.Marasi, pinned)
	}
}

// pinnedMarasiForLuaReference is the marasi version this build links, the
// one go.mod pins.
func pinnedMarasiForLuaReference(t *testing.T) string {
	t.Helper()
	info, ok := debug.ReadBuildInfo()
	if !ok {
		t.Fatal("no build info")
	}
	for _, dep := range info.Deps {
		if dep.Path == "github.com/tfkr-ae/marasi" {
			if dep.Replace != nil {
				t.Skipf("marasi is replaced by %s", dep.Replace.Path)
			}
			return dep.Version
		}
	}
	t.Fatal("the build links no github.com/tfkr-ae/marasi")
	return ""
}
