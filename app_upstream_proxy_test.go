package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/service"
)

func TestAppUpstreamProxy(t *testing.T) {
	t.Run("should add an upstream proxy and select it for the open project", func(t *testing.T) {
		app := newScratchpadApp(t)
		if _, err := app.AddUpstreamProxy("corp", "http://u:secret@127.0.0.1:8080", ""); err != nil {
			t.Fatalf("adding upstream proxy: %v", err)
		}
		state, err := app.UseUpstreamProxy("corp")
		if err != nil {
			t.Fatalf("using upstream proxy: %v", err)
		}
		want := service.UpstreamProxy{Name: "corp", Scheme: "http", Host: "127.0.0.1", Port: 8080, HasCredentials: true}
		if len(state.Items) != 1 || state.Items[0] != want || state.Selected != "corp" || !state.Configured {
			t.Fatalf("\nwanted:\n%+v selected corp, configured\ngot:\n%+v", want, state)
		}
		if got := app.Proxy.UpstreamProxyStatus(); got.Name != "corp" {
			t.Fatalf("\nwanted:\ncorp routing\ngot:\n%+v", got)
		}
	})

	t.Run("should never send credentials to the frontend", func(t *testing.T) {
		app := newScratchpadApp(t)
		state, err := app.AddUpstreamProxy("corp", "socks5://u:secret@127.0.0.1:1080", "")
		if err != nil {
			t.Fatalf("adding upstream proxy: %v", err)
		}
		encoded, _ := json.Marshal(state)
		if strings.Contains(string(encoded), "secret") {
			t.Fatalf("\nwanted:\nno credentials\ngot:\n%s", encoded)
		}
	})

	t.Run("should keep each project's selection", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "http://127.0.0.1:8080", "")
		if _, err := app.UseUpstreamProxy("corp"); err != nil {
			t.Fatalf("using upstream proxy: %v", err)
		}
		other := projectPath(t, app, "other.marasi")
		if err := app.projects.Open(context.Background(), other); err != nil {
			t.Fatalf("opening other project: %v", err)
		}
		if state, _ := app.GetUpstreamProxies(); state.Selected != "" || !state.Configured {
			t.Fatalf("\nwanted:\nno selection in the other project\ngot:\n%+v", state)
		}
		if err := app.projects.Open(context.Background(), scratchpadPath(t, app)); err != nil {
			t.Fatalf("reopening scratchpad: %v", err)
		}
		if state, _ := app.GetUpstreamProxies(); state.Selected != "corp" {
			t.Fatalf("\nwanted:\ncorp selected again\ngot:\n%+v", state)
		}
	})

	t.Run("should go direct when the selection is cleared", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "http://127.0.0.1:8080", "")
		app.UseUpstreamProxy("corp")
		state, err := app.UseUpstreamProxy("")
		if err != nil || state.Selected != "" {
			t.Fatalf("\nwanted:\nno selection\ngot:\n%+v, %v", state, err)
		}
		if got := app.Proxy.UpstreamProxyStatus(); got.Name != "" {
			t.Fatalf("\nwanted:\ndirect\ngot:\n%+v", got)
		}
	})

	t.Run("should report a selection another instance removed as not configured", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "http://127.0.0.1:8080", "")
		app.UseUpstreamProxy("corp")
		if _, err := newSharedConfigUpstreamProxies(t, app).Remove(context.Background(), "corp"); err != nil {
			t.Fatalf("removing from another instance: %v", err)
		}
		state, err := app.GetUpstreamProxies()
		if err != nil || len(state.Items) != 0 || state.Selected != "corp" || state.Configured {
			t.Fatalf("\nwanted:\ncorp selected, not configured\ngot:\n%+v, %v", state, err)
		}
	})

	t.Run("should refuse a name already in the list", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "http://127.0.0.1:8080", "")
		if _, err := app.AddUpstreamProxy("corp", "http://127.0.0.1:9090", ""); !errors.Is(err, marasi.ErrUpstreamProxyExists) {
			t.Fatalf("\nwanted:\n%v\ngot:\n%v", marasi.ErrUpstreamProxyExists, err)
		}
	})

	t.Run("should change the URL and keep the CA", func(t *testing.T) {
		app := newScratchpadApp(t)
		if _, err := app.AddUpstreamProxy("corp", "https://127.0.0.1:8443", testCA(t)); err != nil {
			t.Fatalf("adding upstream proxy: %v", err)
		}
		state, err := app.UpdateUpstreamProxy("corp", "https://127.0.0.1:9443", "", false)
		if err != nil || state.Items[0].Port != 9443 || !state.Items[0].HasCA {
			t.Fatalf("\nwanted:\nport 9443 with its CA\ngot:\n%+v, %v", state, err)
		}
	})

	t.Run("should remove the CA", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "https://127.0.0.1:8443", testCA(t))
		state, err := app.UpdateUpstreamProxy("corp", "", "", true)
		if err != nil || state.Items[0].HasCA || state.Items[0].Port != 8443 {
			t.Fatalf("\nwanted:\nport 8443 without a CA\ngot:\n%+v, %v", state, err)
		}
	})

	t.Run("should refuse an update that changes nothing", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "http://127.0.0.1:8080", "")
		if _, err := app.UpdateUpstreamProxy("corp", "", "", false); !errors.Is(err, errNoUpstreamProxyChange) {
			t.Fatalf("\nwanted:\n%v\ngot:\n%v", errNoUpstreamProxyChange, err)
		}
	})

	t.Run("should report a refused check", func(t *testing.T) {
		app := newScratchpadApp(t)
		app.AddUpstreamProxy("corp", "http://"+closedAddress(t), "")
		result, err := app.CheckUpstreamProxy("corp", "http://example.com")
		if err != nil || result.Outcome != "refused" {
			t.Fatalf("\nwanted:\nrefused\ngot:\n%+v, %v", result, err)
		}
	})
}

// newSharedConfigUpstreamProxies is another instance's upstream proxy list
// over app's marasi_config.yaml.
func newSharedConfigUpstreamProxies(t *testing.T, app *App) *service.UpstreamProxies {
	t.Helper()
	proxy, err := marasi.New(
		marasi.WithLogger(slog.New(slog.NewTextHandler(io.Discard, nil))),
		marasi.WithConfigDir(app.Proxy.ConfigDir),
	)
	if err != nil {
		t.Fatalf("creating second proxy: %v", err)
	}
	return service.NewUpstreamProxies(proxy)
}

// closedAddress is a loopback host:port nothing listens on.
func closedAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	address := listener.Addr().String()
	listener.Close()
	return address
}

// testCA is a self-signed CA certificate as PEM.
func testCA(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Upstream Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("creating certificate: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}
