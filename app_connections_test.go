package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Saved connections live in marasi_appconfig.yaml without their passwords:
// those go to the OS keychain on a release build, and to a 0600 file in the
// app config dir on a development build or when the keychain refuses (Linux
// without Secret Service). Tests replace the keychain with fakeKeychain.

type fakeKeychain struct {
	items   map[string]string
	refuse  error
	removed []string
}

func newFakeKeychain() *fakeKeychain { return &fakeKeychain{items: map[string]string{}} }

func (k *fakeKeychain) funcs() *keychain {
	return &keychain{
		set: func(service, account, secret string) error {
			if k.refuse != nil {
				return k.refuse
			}
			k.items[service+"/"+account] = secret
			return nil
		},
		get: func(service, account string) (string, error) {
			secret, ok := k.items[service+"/"+account]
			if !ok {
				return "", errors.New("secret not found in keyring")
			}
			return secret, nil
		},
		remove: func(service, account string) error {
			k.removed = append(k.removed, service+"/"+account)
			delete(k.items, service+"/"+account)
			return nil
		},
	}
}

func connectionsApp(t *testing.T, kc *fakeKeychain) (*App, string) {
	t.Helper()
	dir := t.TempDir()
	app := loadConfigApp(t, dir)
	if kc != nil {
		app.keychain = kc.funcs()
	}
	return app, dir
}

func appConfigText(t *testing.T, dir string) string {
	t.Helper()
	data, err := os.ReadFile(appConfigPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func addLab(t *testing.T, app *App) SavedConnection {
	t.Helper()
	saved, err := app.AddConnection(NewConnection{Name: "Lab", URL: "http://10.0.0.5:9000/", Password: "s3cret-pw"})
	if err != nil {
		t.Fatalf("adding: %v", err)
	}
	return saved
}

func TestConnectionsStartWithTheLocalOneActive(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	list := app.ListConnections()
	if list.ActiveID != "local" || len(list.Connections) != 1 || list.Connections[0].Kind != "local" || list.Connections[0].Name != "Local" {
		t.Fatalf("got %+v", list)
	}
}

func TestARemoteOnAReleaseBuildKeepsItsPasswordInTheKeychain(t *testing.T) {
	kc := newFakeKeychain()
	app, dir := connectionsApp(t, kc)

	saved := addLab(t, app)
	if saved.Kind != "remote" || saved.URL != "http://10.0.0.5:9000" || saved.Name != "Lab" {
		t.Fatalf("saved %+v", saved)
	}
	if got := kc.items[keychainService+"/"+saved.ID]; got != "s3cret-pw" {
		t.Fatalf("keychain holds %q", got)
	}
	if text := appConfigText(t, dir); strings.Contains(text, "s3cret-pw") || !strings.Contains(text, "keychain:"+saved.ID) {
		t.Fatalf("app config:\n%s", text)
	}
	if _, err := os.Stat(filepath.Join(dir, passwordFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("password file written: %v", err)
	}
	password, err := app.ConnectionPassword(saved.ID)
	if err != nil || password != "s3cret-pw" {
		t.Fatalf("password %q, %v", password, err)
	}
	list := app.ListConnections()
	if len(list.Connections) != 2 || list.Connections[1].ID != saved.ID {
		t.Fatalf("list %+v", list)
	}
}

func TestADevelopmentBuildKeepsPasswordsInAFileOnlyTheUserReads(t *testing.T) {
	app, dir := connectionsApp(t, nil)

	saved := addLab(t, app)
	info, err := os.Stat(filepath.Join(dir, passwordFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode %v", info.Mode().Perm())
	}
	if text := appConfigText(t, dir); strings.Contains(text, "s3cret-pw") || !strings.Contains(text, "file:"+saved.ID) {
		t.Fatalf("app config:\n%s", text)
	}
	// A fresh start reads it back.
	again := loadConfigApp(t, dir)
	password, err := again.ConnectionPassword(saved.ID)
	if err != nil || password != "s3cret-pw" {
		t.Fatalf("password %q, %v", password, err)
	}
}

func TestAKeychainThatRefusesFallsBackToTheFile(t *testing.T) {
	kc := newFakeKeychain()
	kc.refuse = errors.New("The name org.freedesktop.secrets was not provided by any .service files")
	app, dir := connectionsApp(t, kc)

	saved := addLab(t, app)
	if text := appConfigText(t, dir); !strings.Contains(text, "file:"+saved.ID) {
		t.Fatalf("app config:\n%s", text)
	}
	password, err := app.ConnectionPassword(saved.ID)
	if err != nil || password != "s3cret-pw" {
		t.Fatalf("password %q, %v", password, err)
	}
}

func TestANoPasswordRemoteStoresNoSecret(t *testing.T) {
	kc := newFakeKeychain()
	app, dir := connectionsApp(t, kc)
	saved, err := app.AddConnection(NewConnection{Name: "Open", URL: "http://10.0.0.6:9000", NoPassword: true})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.NoPassword || saved.PasswordRef != "" || len(kc.items) != 0 {
		t.Fatalf("saved %+v, keychain %v", saved, kc.items)
	}
	if _, err := os.Stat(filepath.Join(dir, passwordFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("password file written: %v", err)
	}
	if password, err := app.ConnectionPassword(saved.ID); err != nil || password != "" {
		t.Fatalf("password %q, %v", password, err)
	}
}

func TestAddingARemoteNeedsAnAddressAndAPasswordOrNone(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	for _, in := range []NewConnection{
		{Name: "x", URL: "", Password: "p"},
		{Name: "x", URL: "10.0.0.5:9000", Password: "p"},
		{Name: "x", URL: "ftp://10.0.0.5:9000", Password: "p"},
		{Name: "x", URL: "http://10.0.0.5:9000"},
	} {
		if _, err := app.AddConnection(in); err == nil {
			t.Errorf("%+v was accepted", in)
		}
	}
	if len(app.ListConnections().Connections) != 1 {
		t.Fatal("a refused connection was saved")
	}
}

func TestANamelessRemoteIsNamedForItsHost(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	saved, err := app.AddConnection(NewConnection{URL: "http://10.0.0.5:9000", Password: "p"})
	if err != nil || saved.Name != "10.0.0.5:9000" {
		t.Fatalf("saved %+v, %v", saved, err)
	}
}

func TestChangingARemotesPasswordReplacesTheSecret(t *testing.T) {
	kc := newFakeKeychain()
	app, _ := connectionsApp(t, kc)
	saved := addLab(t, app)
	if err := app.SetConnectionPassword(saved.ID, "new-pw"); err != nil {
		t.Fatal(err)
	}
	if password, _ := app.ConnectionPassword(saved.ID); password != "new-pw" {
		t.Fatalf("password %q", password)
	}
}

func TestEditingARemotesAddressKeepsItsPassword(t *testing.T) {
	kc := newFakeKeychain()
	app, dir := connectionsApp(t, kc)
	saved := addLab(t, app)
	updated, err := app.SetConnectionAddress(saved.ID, "http://10.0.0.7:9100")
	if err != nil || updated.URL != "http://10.0.0.7:9100" {
		t.Fatalf("updated %+v, %v", updated, err)
	}
	if _, err := app.SetConnectionAddress(saved.ID, "not a url"); err == nil {
		t.Fatal("a bad address was accepted")
	}
	if _, err := app.SetConnectionAddress("local", "http://10.0.0.7:9100"); err == nil {
		t.Fatal("the local connection's address changed")
	}
	if !strings.Contains(appConfigText(t, dir), "10.0.0.7:9100") {
		t.Fatal("the address wasn't saved")
	}
	if password, _ := app.ConnectionPassword(saved.ID); password != "s3cret-pw" {
		t.Fatalf("password %q", password)
	}
}

func TestRemovingARemoteForgetsItsPasswordAndRecents(t *testing.T) {
	kc := newFakeKeychain()
	app, dir := connectionsApp(t, kc)
	saved := addLab(t, app)
	if err := app.AddRecentProject(saved.ID, "acme", "/srv/acme.marasi"); err != nil {
		t.Fatal(err)
	}
	if err := app.RemoveConnection(saved.ID); err != nil {
		t.Fatal(err)
	}
	if len(kc.items) != 0 || len(app.ListConnections().Connections) != 1 {
		t.Fatalf("keychain %v, list %+v", kc.items, app.ListConnections())
	}
	if text := appConfigText(t, dir); strings.Contains(text, saved.ID) {
		t.Fatalf("app config still names it:\n%s", text)
	}
}

func TestTheLocalAndTheActiveConnectionCantBeRemoved(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	saved := addLab(t, app)
	if err := app.RemoveConnection("local"); err == nil {
		t.Fatal("removed the local connection")
	}
	if err := app.SetActiveConnection(saved.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.RemoveConnection(saved.ID); err == nil {
		t.Fatal("removed the active connection")
	}
}

func TestTheActiveConnectionIsSavedAcrossStarts(t *testing.T) {
	app, dir := connectionsApp(t, nil)
	saved := addLab(t, app)
	if err := app.SetActiveConnection("nope"); err == nil {
		t.Fatal("an unknown connection became active")
	}
	if err := app.SetActiveConnection(saved.ID); err != nil {
		t.Fatal(err)
	}
	again := loadConfigApp(t, dir)
	if got := again.ListConnections().ActiveID; got != saved.ID {
		t.Fatalf("active %q", got)
	}
}

func TestRecentProjectsAreKeptPerConnection(t *testing.T) {
	app, dir := connectionsApp(t, nil)
	saved := addLab(t, app)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(app.AddRecentProject("local", "alpha", "/me/alpha.marasi"))
	must(app.AddRecentProject("local", "beta", "/me/beta.marasi"))
	must(app.AddRecentProject(saved.ID, "acme", "/srv/acme.marasi"))
	// Opening alpha again brings it to the top, once.
	must(app.AddRecentProject("local", "alpha", "/me/alpha.marasi"))

	again := loadConfigApp(t, dir)
	local := again.RecentProjects("local")
	if len(local) != 2 || local[0].Path != "/me/alpha.marasi" || local[1].Path != "/me/beta.marasi" || local[0].Opened == "" {
		t.Fatalf("local %+v", local)
	}
	remote := again.RecentProjects(saved.ID)
	if len(remote) != 1 || remote[0].Name != "acme" {
		t.Fatalf("remote %+v", remote)
	}
	if err := app.AddRecentProject("nope", "x", "/x.marasi"); err == nil {
		t.Fatal("recents saved for an unknown connection")
	}
}

func TestRecentProjectsKeepTheLatestFew(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	for i := 0; i < recentProjectsLimit+3; i++ {
		name := string(rune('a' + i))
		if err := app.AddRecentProject("local", name, "/me/"+name+".marasi"); err != nil {
			t.Fatal(err)
		}
	}
	recents := app.RecentProjects("local")
	if len(recents) != recentProjectsLimit || recents[0].Name != string(rune('a'+recentProjectsLimit+2)) {
		t.Fatalf("recents %+v", recents)
	}
}

// A platform's own secure store (Android's) wins over go-keyring, in every
// build: it never prompts.
func TestPlatformKeychainIsUsedInEveryBuild(t *testing.T) {
	kc := newFakeKeychain()
	saved := platformKeychain
	platformKeychain = kc.funcs
	t.Cleanup(func() { platformKeychain = saved })

	app := &App{}
	app.useKeychainRuntime()
	if app.keychain == nil {
		t.Fatal("a development build with a platform keychain should use it")
	}
	if err := app.keychain.set(keychainService, "lab", "s3cret"); err != nil {
		t.Fatal(err)
	}
	if kc.items[keychainService+"/lab"] != "s3cret" {
		t.Fatalf("the password went elsewhere: %v", kc.items)
	}
}
