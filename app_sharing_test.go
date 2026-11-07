package main

import (
	"slices"
	"strings"
	"testing"
)

// Sharing the local instance reads its pairing payload through the CLI (the
// service hands it out only on the socket), and turning a remote's password
// off forgets the saved secret and keeps the origins the service allows.

func TestLocalPairingReadsThePayloadThroughTheSocket(t *testing.T) {
	cli := (&fakeCLI{}).answer("service control pair", 0, `{"url":"http://100.64.1.2:9000","password":"pw","instance":"default"}`)
	app := localApp(t, cli)

	pairing, err := app.LocalPairing()
	if err != nil {
		t.Fatal(err)
	}
	if want := (Pairing{URL: "http://100.64.1.2:9000", Password: "pw", Instance: "default"}); pairing != want {
		t.Fatalf("pairing = %+v, want %+v", pairing, want)
	}
	if args := cli.lastCall("service control pair").args; !slices.Contains(args, "--json") || slices.Contains(args, "--host") {
		t.Fatalf("pair args %v: want --json and no --host (the app applies the host itself)", args)
	}
}

func TestLocalPairingWithoutAListenerSaysSo(t *testing.T) {
	cli := (&fakeCLI{}).answer("service control pair", 1, `{"error":"reading pairing: the instance has no control listener network address"}`)
	app := localApp(t, cli)

	if _, err := app.LocalPairing(); err == nil || !strings.Contains(err.Error(), "no control listener") {
		t.Fatalf("err = %v, want the CLI's reason", err)
	}
}

func TestTurningARemotesPasswordOffForgetsItAndKeepsTheOrigins(t *testing.T) {
	kc := newFakeKeychain()
	app, dir := connectionsApp(t, kc)
	saved := addLab(t, app)

	if err := app.SetConnectionNoPassword(saved.ID, []string{"http://localhost:5173", "wails://wails"}); err != nil {
		t.Fatal(err)
	}

	if password, err := app.ConnectionPassword(saved.ID); err != nil || password != "" {
		t.Fatalf("password %q, %v; want none", password, err)
	}
	list := app.ListConnections().Connections
	got := list[slices.IndexFunc(list, func(c SavedConnection) bool { return c.ID == saved.ID })]
	if !got.NoPassword || !slices.Equal(got.AllowedOrigins, []string{"http://localhost:5173", "wails://wails"}) || got.PasswordRef != "" {
		t.Fatalf("saved = %+v", got)
	}
	if text := appConfigText(t, dir); !strings.Contains(text, "wails://wails") || strings.Contains(text, "password_ref") {
		t.Fatalf("config:\n%s", text)
	}
	if len(kc.items) != 0 || !slices.Contains(kc.removed, keychainService+"/"+saved.ID) {
		t.Fatalf("keychain %v, removed %v: the old password is still saved", kc.items, kc.removed)
	}
}

func TestTurningAPasswordOffNeedsOriginsAndARemote(t *testing.T) {
	app, _ := connectionsApp(t, newFakeKeychain())
	saved := addLab(t, app)
	if err := app.SetConnectionNoPassword(saved.ID, nil); err == nil {
		t.Fatal("no origins accepted")
	}
	if err := app.SetConnectionNoPassword(localConnectionID, []string{"wails://wails"}); err == nil {
		t.Fatal("the local connection has no saved password to turn off")
	}
}

func TestSettingAPasswordAgainClearsTheNoPasswordOrigins(t *testing.T) {
	app, _ := connectionsApp(t, newFakeKeychain())
	saved := addLab(t, app)
	if err := app.SetConnectionNoPassword(saved.ID, []string{"wails://wails"}); err != nil {
		t.Fatal(err)
	}
	if err := app.SetConnectionPassword(saved.ID, "again-pw"); err != nil {
		t.Fatal(err)
	}
	list := app.ListConnections().Connections
	got := list[slices.IndexFunc(list, func(c SavedConnection) bool { return c.ID == saved.ID })]
	if got.NoPassword || len(got.AllowedOrigins) != 0 {
		t.Fatalf("saved = %+v", got)
	}
	if password, _ := app.ConnectionPassword(saved.ID); password != "again-pw" {
		t.Fatalf("password %q", password)
	}
}
