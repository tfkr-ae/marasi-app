//go:build carried_cli && ((darwin && arm64) || (linux && amd64) || (windows && amd64))

package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	goruntime "runtime"
	"testing"
)

// A build with the carried_cli tag, after cmd/carry-cli wrote carried_cli/:
// the copy it embeds is this platform's, matches its checksum, and is the
// build its record names.
func TestTheEmbeddedCarriedCLIMatchesItsRecord(t *testing.T) {
	app := &App{}
	app.useCLIRuntime()
	carried := app.cliRuntime.carried
	if carried == nil {
		t.Fatal("a carried_cli build carries no CLI")
	}
	if carried.GOOS != goruntime.GOOS || carried.GOARCH != goruntime.GOARCH {
		t.Fatalf("carries a CLI for %s/%s", carried.GOOS, carried.GOARCH)
	}
	gz, err := gzip.NewReader(bytes.NewReader(carried.gzipped))
	if err != nil {
		t.Fatal(err)
	}
	binary, err := io.ReadAll(gz)
	if err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256(binary); hex.EncodeToString(sum[:]) != carried.SHA256 {
		t.Fatal("the carried CLI doesn't match its checksum")
	}
	path := filepath.Join(t.TempDir(), cliFileName(goruntime.GOOS))
	if err := os.WriteFile(path, binary, 0o755); err != nil {
		t.Fatal(err)
	}
	build, err := readCLIBuild(path)
	if err != nil {
		t.Fatal(err)
	}
	if build.Version != carried.Version || build.Channel != carried.Channel {
		t.Fatalf("the carried CLI is %+v, its record says %s on %s", build, carried.Version, carried.Channel)
	}
}
