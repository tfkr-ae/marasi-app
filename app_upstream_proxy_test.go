package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The upstream proxy list is the service's; the app only reads the CA file
// the researcher picks, which the frontend sends with the entry.
func TestReadUpstreamProxyCAFile(t *testing.T) {
	// The native file dialog cannot be driven; MARASI_UPSTREAM_PROXY_CA_FILE
	// stands in for the path the user would pick.
	t.Run("should read a CA file as it is", func(t *testing.T) {
		app := newTestApp(t)
		path := filepath.Join(t.TempDir(), "corp-ca.pem")
		want := "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
		if err := os.WriteFile(path, []byte(want), 0600); err != nil {
			t.Fatal(err)
		}
		t.Setenv(upstreamProxyCAFileEnv, path)

		ca, err := app.ReadUpstreamProxyCAFile()
		if err != nil || ca != want {
			t.Fatalf("\nwanted:\n%q\ngot:\n%q, %v", want, ca, err)
		}
	})

	t.Run("should refuse a CA file over 1 MiB", func(t *testing.T) {
		app := newTestApp(t)
		path := filepath.Join(t.TempDir(), "huge.pem")
		if err := os.WriteFile(path, make([]byte, maxUpstreamProxyCAFileSize+1), 0600); err != nil {
			t.Fatal(err)
		}
		t.Setenv(upstreamProxyCAFileEnv, path)

		if _, err := app.ReadUpstreamProxyCAFile(); err == nil || !strings.Contains(err.Error(), "too large") {
			t.Fatalf("\nwanted:\ntoo large\ngot:\n%v", err)
		}
	})
}
