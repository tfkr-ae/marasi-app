package main

import (
	"reflect"
	"slices"
	"strings"
	"testing"
)

// Local connections for named instances: each names a service instance on
// this machine and an optional proxy port. Local is the one for `default`.

func addWork(t *testing.T, app *App, port int) SavedConnection {
	t.Helper()
	saved, err := app.AddLocalConnection(NewLocalConnection{Name: "Work", Instance: "work", Port: port})
	if err != nil {
		t.Fatalf("adding: %v", err)
	}
	return saved
}

func TestAnAddedLocalConnectionIsListedAndSavedAcrossStarts(t *testing.T) {
	app, dir := connectionsApp(t, nil)
	saved := addWork(t, app, 8181)

	if saved.Kind != "local" || saved.Instance != "work" || saved.Port != 8181 || saved.Name != "Work" || saved.ID == "" {
		t.Fatalf("saved %+v", saved)
	}
	next := loadConfigApp(t, dir)
	list := next.ListConnections().Connections
	if len(list) != 2 || list[0].ID != localConnectionID || list[0].Instance != "default" || !reflect.DeepEqual(list[1], saved) {
		t.Fatalf("listed %+v after a relaunch, want Local then %+v", list, saved)
	}
}

func TestAddingALocalConnectionNeedsAUsableNewInstanceName(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	addWork(t, app, 0)
	for _, name := range []string{"", "  ", "default", "work", "a/b", `a\b`, "..", "x.sock"} {
		if _, err := app.AddLocalConnection(NewLocalConnection{Instance: name}); err == nil {
			t.Errorf("added a local connection for instance %q", name)
		}
	}
	if _, err := app.AddLocalConnection(NewLocalConnection{Instance: "lab", Port: 70000}); err == nil {
		t.Error("added a local connection on port 70000")
	}
	if got := len(app.ListConnections().Connections); got != 2 {
		t.Fatalf("listed %d connections, want Local and Work", got)
	}
}

func TestANamelessLocalConnectionIsNamedForItsInstance(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	saved, err := app.AddLocalConnection(NewLocalConnection{Instance: " lab "})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Name != "lab" || saved.Instance != "lab" {
		t.Fatalf("saved %+v, want it named and keyed lab", saved)
	}
}

func TestEditingALocalConnectionsPortKeepsTheRest(t *testing.T) {
	app, dir := connectionsApp(t, nil)
	saved := addWork(t, app, 8181)

	edited, err := app.SetConnectionPort(saved.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if edited.Port != 0 || edited.Instance != "work" || edited.Name != "Work" {
		t.Fatalf("edited %+v", edited)
	}
	if got := loadConfigApp(t, dir).ListConnections().Connections[1]; got.Port != 0 {
		t.Fatalf("relaunch reads port %d, want none", got.Port)
	}
	if _, err := app.SetConnectionPort(localConnectionID, 9000); err == nil {
		t.Fatal("set a port on Local, whose listener is the app's default")
	}
	lab := addLab(t, app)
	if _, err := app.SetConnectionPort(lab.ID, 9000); err == nil {
		t.Fatal("set a port on a remote")
	}
	if _, err := app.SetConnectionAddress(saved.ID, "http://10.0.0.1:9000"); err == nil {
		t.Fatal("set an address on a local connection")
	}
}

func TestRemovingALocalConnectionForgetsItsRecentsAndOwnedRun(t *testing.T) {
	app, dir := connectionsApp(t, nil)
	saved := addWork(t, app, 0)
	if err := app.AddRecentProject(saved.ID, "a", "/p/a.marasi"); err != nil {
		t.Fatal(err)
	}
	if err := app.AddRecentProject(localConnectionID, "b", "/p/b.marasi"); err != nil {
		t.Fatal(err)
	}
	app.saveOwnedRun(saved.ID, "run-work")
	app.saveOwnedRun(localConnectionID, "run-local")

	if err := app.SetActiveConnection(saved.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.RemoveConnection(saved.ID); err == nil {
		t.Fatal("removed the active local connection")
	}
	if err := app.SetActiveConnection(localConnectionID); err != nil {
		t.Fatal(err)
	}
	if err := app.RemoveConnection(saved.ID); err != nil {
		t.Fatal(err)
	}

	next := loadConfigApp(t, dir)
	if len(next.ListConnections().Connections) != 1 {
		t.Fatalf("still lists %+v", next.ListConnections().Connections)
	}
	if len(next.RecentProjects(saved.ID)) != 0 || len(next.RecentProjects(localConnectionID)) != 1 {
		t.Fatal("removing Work touched the wrong recents")
	}
	if got := next.ownedRunConnections(); !slices.Equal(got, []string{localConnectionID}) {
		t.Fatalf("owned runs on %v, want only Local's", got)
	}
}

func TestEachLocalConnectionKeepsItsOwnRecentsAndOwnedRun(t *testing.T) {
	app, _ := connectionsApp(t, nil)
	work := addWork(t, app, 0)
	lab, err := app.AddLocalConnection(NewLocalConnection{Instance: "lab"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{work.ID, lab.ID} {
		if err := app.AddRecentProject(id, id, "/p/"+id+".marasi"); err != nil {
			t.Fatal(err)
		}
		app.saveOwnedRun(id, "run-"+id)
	}
	for _, id := range []string{work.ID, lab.ID} {
		recents := app.RecentProjects(id)
		if len(recents) != 1 || !strings.Contains(recents[0].Path, id) {
			t.Fatalf("recents of %s = %+v", id, recents)
		}
		if app.savedOwnedRun(id) != "run-"+id {
			t.Fatalf("owned run of %s = %q", id, app.savedOwnedRun(id))
		}
	}
}
