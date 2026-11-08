package main

import (
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
