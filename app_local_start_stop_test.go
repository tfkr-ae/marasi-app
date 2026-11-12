package main

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

// Stop and Start of a local connection's instance from inside the app
// (StopLocalInstance, StartLocalInstance), over the fake CLI.

func TestStopLocalInstanceStopsTheInstanceAndClearsTheOwnedRun(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	if err := app.StopLocalInstance(localConnectionID); err != nil {
		t.Fatal(err)
	}

	if cli.stops() != 1 {
		t.Fatalf("calls %v, want one stop", cli.subcommands())
	}
	if instance := flagValue(cli.lastCall("service stop").args, "--instance"); instance != "default" {
		t.Fatalf("stopped instance %q, want default", instance)
	}
	if run := app.savedOwnedRun(localConnectionID); run != "" {
		t.Fatalf("owned run %q kept after the stop", run)
	}
	app.ServiceShutdown()
	if cli.stops() != 1 {
		t.Fatalf("quitting stopped again after the app's Stop (calls %v)", cli.subcommands())
	}
}

func TestStopLocalInstanceStopsARunTheAppDoesNotOwn(t *testing.T) {
	cli := (&fakeCLI{}).answer("service stop", 0, stopped)
	app := localApp(t, cli)

	if err := app.StopLocalInstance(localConnectionID); err != nil {
		t.Fatal(err)
	}
	if want := []string{"service stop"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
}

func TestStopLocalInstanceReportsTheCLIsError(t *testing.T) {
	cli := (&fakeCLI{}).answer("service stop", 1, `{"error":"permission denied"}`)
	app := localApp(t, cli)
	app.saveOwnedRun(localConnectionID, "run-app")

	err := app.StopLocalInstance(localConnectionID)

	if err == nil || !strings.Contains(err.Error(), "permission denied") || !strings.Contains(err.Error(), codeInstanceFailed) {
		t.Fatalf("err = %v, want the CLI's error as instance_failed", err)
	}
	if run := app.savedOwnedRun(localConnectionID); run != "run-app" {
		t.Fatalf("owned run %q, want it kept while the run may still be there", run)
	}
}

func TestStopLocalInstanceOfOneAlreadyStoppedSucceeds(t *testing.T) {
	cli := (&fakeCLI{}).answer("service stop", 1, notRunning)
	app := localApp(t, cli)
	app.saveOwnedRun(localConnectionID, "run-app")

	if err := app.StopLocalInstance(localConnectionID); err != nil {
		t.Fatalf("err = %v, want a stopped instance to stay stopped", err)
	}
	if run := app.savedOwnedRun(localConnectionID); run != "" {
		t.Fatalf("owned run %q kept for an instance that isn't running", run)
	}
}

func TestStartLocalInstanceStartsItsProjectAndOwnsTheRun(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-started")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)

	if err := app.StartLocalInstance(localConnectionID, "/p/engagement.marasi"); err != nil {
		t.Fatal(err)
	}

	if want := []string{"service status", "service start", "service status"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	start := cli.lastCall("service start")
	if project := flagValue(start.args, "--project"); project != "/p/engagement.marasi" {
		t.Fatalf("started project %q, want the one the app had", project)
	}
	if port := flagValue(start.args, "--port"); port != "8080" {
		t.Fatalf("started on port %q, want the connect path's default", port)
	}
	if password, ok := start.envValue("MARASI_PASSWORD"); !ok || password != "generated" {
		t.Fatalf("MARASI_PASSWORD = %q, want the generated password", password)
	}

	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if !connection.StartedByApp {
		t.Fatal("the started run doesn't read as the app's")
	}
	app.ServiceShutdown()
	if cli.stops() != 1 {
		t.Fatalf("calls %v, want the started run stopped on quit", cli.subcommands())
	}
}

func TestStartLocalInstanceWithoutAProjectLetsTheServicePick(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-started")).
		answer("service start", 0, started)
	app := localApp(t, cli)

	if err := app.StartLocalInstance(localConnectionID, ""); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(cli.lastCall("service start").args, "--project") {
		t.Fatalf("start args %v pass --project without one", cli.lastCall("service start").args)
	}
}

func TestStartLocalInstanceLeavesARunningInstanceAlone(t *testing.T) {
	cli := (&fakeCLI{}).answer("service status", 0, runOf("run-other"))
	app := localApp(t, cli)

	if err := app.StartLocalInstance(localConnectionID, "/p/engagement.marasi"); err != nil {
		t.Fatal(err)
	}
	if want := []string{"service status"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want only the status (connect attaches)", cli.subcommands())
	}
	if run := app.savedOwnedRun(localConnectionID); run != "" {
		t.Fatalf("owned run %q saved for another client's run", run)
	}
}

func TestStartLocalInstanceReportsAFailedStart(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 1, `{"error":"opening project: no such file"}`)
	app := localApp(t, cli)

	err := app.StartLocalInstance(localConnectionID, "/p/gone.marasi")

	if err == nil || !strings.Contains(err.Error(), "no such file") || !strings.Contains(err.Error(), codeInstanceFailed) {
		t.Fatalf("err = %v, want the CLI's error as instance_failed", err)
	}
}

func TestStartAndStopRefuseAConnectionThatIsNotLocal(t *testing.T) {
	cli := &fakeCLI{}
	app := localApp(t, cli)

	if err := app.StartLocalInstance("remote-abc", ""); err == nil {
		t.Fatal("started through a connection that isn't local")
	}
	if err := app.StopLocalInstance("remote-abc"); err == nil {
		t.Fatal("stopped through a connection that isn't local")
	}
	if len(cli.calls) != 0 {
		t.Fatalf("ran the CLI %v for a connection that isn't local", cli.subcommands())
	}
}

// namedLocalApp is quittingApp with the local connection Work for instance
// work saved on port.
func namedLocalApp(t *testing.T, cli *fakeCLI, port int) (*App, SavedConnection) {
	t.Helper()
	app := quittingApp(t, cli)
	work, err := app.AddLocalConnection(NewLocalConnection{Name: "Work", Instance: "work", Port: port})
	if err != nil {
		t.Fatal(err)
	}
	return app, work
}

func TestStartingANamedInstancePassesItsNameAndSavedPort(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, `{"error":"instance work is not running"}`).
		answer("service status", 0, runOf("run-work")).
		answer("service start", 0, started).
		answer("service stop", 0, stopped)
	app, work := namedLocalApp(t, cli, 8181)

	if err := app.StartLocalInstance(work.ID, ""); err != nil {
		t.Fatal(err)
	}
	start := cli.lastCall("service start")
	if got := flagValue(start.args, "--instance"); got != "work" {
		t.Fatalf("started instance %q, want work", got)
	}
	if got := flagValue(start.args, "--port"); got != "8181" {
		t.Fatalf("started on port %q, want the saved 8181", got)
	}
	if app.savedOwnedRun(work.ID) != "run-work" || app.savedOwnedRun(localConnectionID) != "" {
		t.Fatal("the run isn't owned on Work alone")
	}

	if err := app.StopLocalInstance(work.ID); err != nil {
		t.Fatal(err)
	}
	if got := flagValue(cli.lastCall("service stop").args, "--instance"); got != "work" {
		t.Fatalf("stopped instance %q, want work", got)
	}
}

func TestANamedInstanceWithoutASavedPortStartsOnAnyFreePort(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, `{"error":"instance work is not running"}`).
		answer("service status", 0, runOf("run-work")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app, work := namedLocalApp(t, cli, 0)

	if _, err := app.ConnectLocal(work.ID); err != nil {
		t.Fatal(err)
	}
	if starts := cli.startCalls(); len(starts) != 1 || flagValue(starts[0].args, "--port") != "0" {
		t.Fatalf("starts %v, want one on --port 0", starts)
	}
	if got := flagValue(cli.lastCall("service control pair").args, "--instance"); got != "work" {
		t.Fatalf("paired with instance %q, want work", got)
	}
}

func TestASavedPortThatIsTakenFailsTheStart(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, `{"error":"instance work is not running"}`).
		answer("service start", 1, `{"error":"listen tcp 127.0.0.1:8181: bind: address already in use"}`)
	app, work := namedLocalApp(t, cli, 8181)

	if err := app.StartLocalInstance(work.ID, ""); err == nil || !strings.Contains(err.Error(), "already in use") {
		t.Fatalf("err = %v, want the taken port", err)
	}
	if len(cli.startCalls()) != 1 {
		t.Fatalf("started %d times, want no retry on another port than the saved one", len(cli.startCalls()))
	}
}

func TestARemovedLocalConnectionReachesNoInstance(t *testing.T) {
	cli := &fakeCLI{}
	app, work := namedLocalApp(t, cli, 0)
	if err := app.RemoveConnection(work.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.StartLocalInstance(work.ID, ""); err == nil {
		t.Fatal("started the instance of a removed connection")
	}
	if len(cli.calls) != 0 {
		t.Fatalf("ran the CLI %v", cli.subcommands())
	}
}

func TestLocalInstancesListsTheInstancesTheCLIReports(t *testing.T) {
	cli := (&fakeCLI{}).answer("service list", 0,
		`{"items":[`+runOf("run-1")+`,{"status":"unhealthy","instance":"broken","proxy_listener":null},{"status":"running","instance":"work","run_id":"r"}]}`)
	app := quittingApp(t, cli)

	instances, err := app.LocalInstances()
	if err != nil {
		t.Fatal(err)
	}
	want := []LocalInstance{
		{Instance: "default", Status: "running", Version: "dev", Project: "/p/scratchpad.marasi", ProxyListener: "127.0.0.1:8080"},
		{Instance: "broken", Status: "unhealthy"},
		{Instance: "work", Status: "running"},
	}
	if !slices.Equal(instances, want) {
		t.Fatalf("instances = %+v, want %+v", instances, want)
	}
}

func TestLocalInstancesReportsAMissingCLI(t *testing.T) {
	app := quittingApp(t, &fakeCLI{})
	app.findCLI = func() (string, error) { return "", errors.New("no marasi") }
	if _, err := app.LocalInstances(); err == nil || !strings.Contains(err.Error(), codeCLIMissing) {
		t.Fatalf("err = %v, want cli_missing", err)
	}
}

func TestANamedInstanceStartsOnItsOwnProjectUnlessGivenOne(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, `{"error":"instance work is not running"}`).
		answer("service status", 0, runOf("run-work")).
		answer("service status", 1, `{"error":"instance work is not running"}`).
		answer("service status", 0, runOf("run-work-2")).
		answer("service start", 0, started)
	app, work := namedLocalApp(t, cli, 0)

	// The scratchpad is Local's, open there already: two instances can't
	// share a project.
	if err := app.StartLocalInstance(work.ID, ""); err != nil {
		t.Fatal(err)
	}
	first := cli.lastCall("service start")
	if got := flagValue(first.args, "--project-name"); got != "work" {
		t.Fatalf("started project name %q, want the instance's own, work", got)
	}
	if err := app.StartLocalInstance(work.ID, "/p/engagement.marasi"); err != nil {
		t.Fatal(err)
	}
	second := cli.lastCall("service start")
	if flagValue(second.args, "--project") != "/p/engagement.marasi" || slices.Contains(second.args, "--project-name") {
		t.Fatalf("start args %v, want only the given project", second.args)
	}
}
