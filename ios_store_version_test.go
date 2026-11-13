package main

import (
	"os/exec"
	"testing"
)

// The App Store rejects an upload whose version is not higher than the last
// one, so a date version must sort as a date.
func TestIOSStoreVersion(t *testing.T) {
	cases := map[string]string{
		"29.10.2026":                   "2026.10.29",
		"05.11.2026":                   "2026.11.5",
		"05.11.2026 (nightly abc1234)": "2026.11.5",
		"v1.2.3":                       "1.2.3",
		"1.2":                          "1.2",
		"":                             "",
	}
	for in, want := range cases {
		out, err := exec.Command("sh", "build/ios/scripts/store-version.sh", in).Output()
		if err != nil {
			t.Fatalf("store-version.sh %q: %v", in, err)
		}
		if got := string(out); got != want {
			t.Errorf("store-version.sh %q = %q, want %q", in, got, want)
		}
	}
}
