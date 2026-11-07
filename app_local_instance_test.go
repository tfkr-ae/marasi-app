package main

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

// The local instance is reached through the Marasi CLI, which these tests
// replace with fakeCLI: a scripted answer per subcommand, and a record of
// every call.

type cliCall struct {
	path string
	args []string
	env  []string
}

// subcommand is the call's command words, such as "service control start",
// without the global flags.
func (c cliCall) subcommand() string {
	var words []string
	for i := 0; i < len(c.args); i++ {
		arg := c.args[i]
		switch {
		case arg == "--instance" || arg == "--config-dir":
			i++
		case strings.HasPrefix(arg, "--"):
			// The command's own flags follow its words.
			if len(words) > 0 {
				return strings.Join(words, " ")
			}
		default:
			words = append(words, arg)
		}
	}
	return strings.Join(words, " ")
}

func (c cliCall) envValue(name string) (string, bool) {
	for _, entry := range c.env {
		if value, ok := strings.CutPrefix(entry, name+"="); ok {
			return value, true
		}
	}
	return "", false
}

type cliAnswer struct {
	stdout string
	exit   int
}

type fakeCLI struct {
	answers map[string][]cliAnswer
	calls   []cliCall
}

// answer queues stdout and an exit code for the next call of subcommand.
func (f *fakeCLI) answer(subcommand string, exit int, stdout string) *fakeCLI {
	if f.answers == nil {
		f.answers = map[string][]cliAnswer{}
	}
	f.answers[subcommand] = append(f.answers[subcommand], cliAnswer{stdout: stdout, exit: exit})
	return f
}

func (f *fakeCLI) run(_ context.Context, path string, args, env []string) ([]byte, int, error) {
	call := cliCall{path: path, args: slices.Clone(args), env: slices.Clone(env)}
	f.calls = append(f.calls, call)
	queue := f.answers[call.subcommand()]
	if len(queue) == 0 {
		return nil, 0, errors.New("fake CLI has no answer for " + call.subcommand())
	}
	next := queue[0]
	if len(queue) > 1 {
		f.answers[call.subcommand()] = queue[1:]
	}
	return []byte(next.stdout), next.exit, nil
}

func (f *fakeCLI) subcommands() []string {
	names := make([]string, len(f.calls))
	for i, call := range f.calls {
		names[i] = call.subcommand()
	}
	return names
}

func (f *fakeCLI) lastCall(subcommand string) cliCall {
	for i := len(f.calls) - 1; i >= 0; i-- {
		if f.calls[i].subcommand() == subcommand {
			return f.calls[i]
		}
	}
	return cliCall{}
}

const (
	notRunning     = `{"error":"instance default is not running"}`
	runningNoCtl   = `{"status":"running","version":"dev","instance":"default","project":"/p/scratchpad.marasi","proxy_listener":"127.0.0.1:8080","control_listener":null}`
	runningWithCtl = `{"status":"running","version":"dev","instance":"default","project":"/p/scratchpad.marasi","proxy_listener":"127.0.0.1:8080","control_listener":"127.0.0.1:51391"}`
	started        = `{"instance":"default","proxy_listener":"127.0.0.1:52000","control_listener":"127.0.0.1:52001"}`
	controlActive  = `{"status":"active","control_listener":"127.0.0.1:52001","password_set":true,"allowed_origins":[]}`
	paired         = `{"url":"http://127.0.0.1:52001","password":"from-pair","instance":"default"}`
	stopped        = `{"instance":"default","status":"stopped"}`
)

// localApp is an App whose local instance runs through cli, finds the CLI
// at /bin/marasi, and generates the password "generated".
func localApp(t *testing.T, cli *fakeCLI) *App {
	t.Helper()
	t.Setenv(cliConfigDirEnv, "")
	app := &App{}
	app.useLocalInstanceRuntime()
	app.runCLI = cli.run
	app.findCLI = func() (string, error) { return "/bin/marasi", nil }
	app.newPassword = func() (string, error) { return "generated", nil }
	return app
}

func TestConnectLocalStartsTheInstanceWhenItIsNotRunning(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)

	connection, err := app.ConnectLocal()
	if err != nil {
		t.Fatal(err)
	}

	if want := []string{"service status", "service start", "service control pair"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	start := cli.lastCall("service start")
	if start.path != "/bin/marasi" {
		t.Fatalf("ran %q, want the CLI found", start.path)
	}
	for _, flag := range [][]string{{"--port", "0"}, {"--control-address", "127.0.0.1:0"}, {"--instance", "default"}} {
		if i := slices.Index(start.args, flag[0]); i < 0 || i+1 >= len(start.args) || start.args[i+1] != flag[1] {
			t.Fatalf("start args %v lack %s %s", start.args, flag[0], flag[1])
		}
	}
	if password, _ := start.envValue("MARASI_PASSWORD"); password != "generated" {
		t.Fatalf("start's MARASI_PASSWORD = %q, want the generated password", password)
	}
	if slices.ContainsFunc(start.args, func(arg string) bool { return strings.Contains(arg, "generated") }) {
		t.Fatalf("the password is in the arguments, where ps shows it: %v", start.args)
	}
	want := LocalConnection{URL: "http://127.0.0.1:52001", Password: "from-pair", Instance: "default", StartedByApp: true}
	if connection != want {
		t.Fatalf("connection = %+v, want %+v", connection, want)
	}
}

func TestConnectLocalAttachesToARunningInstanceWithoutStartingAnother(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runningWithCtl).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)

	connection, err := app.ConnectLocal()
	if err != nil {
		t.Fatal(err)
	}

	if want := []string{"service status", "service control pair"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	if connection.StartedByApp {
		t.Fatal("an instance the app attached to reads as started by the app")
	}
	if connection.URL != "http://127.0.0.1:52001" || connection.Password != "from-pair" {
		t.Fatalf("connection = %+v, want the pairing's address and password", connection)
	}
}

func TestConnectLocalTurnsOnAControlListenerWhenTheRunningInstanceHasNone(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runningNoCtl).
		answer("service control start", 0, controlActive).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)

	connection, err := app.ConnectLocal()
	if err != nil {
		t.Fatal(err)
	}

	if want := []string{"service status", "service control start", "service control pair"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	control := cli.lastCall("service control start")
	for _, flag := range [][]string{{"--address", "127.0.0.1"}, {"--port", "0"}} {
		if i := slices.Index(control.args, flag[0]); i < 0 || i+1 >= len(control.args) || control.args[i+1] != flag[1] {
			t.Fatalf("control start args %v lack %s %s", control.args, flag[0], flag[1])
		}
	}
	if password, _ := control.envValue("MARASI_PASSWORD"); password != "generated" {
		t.Fatalf("control start's MARASI_PASSWORD = %q, want the generated password", password)
	}
	if connection.StartedByApp {
		t.Fatal("turning on a control listener made the instance the app's to stop")
	}
}

func TestConnectLocalAttachesWhenTheInstanceStartedMeanwhile(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 1, `{"error":"instance already running: instance lock held: resource temporarily unavailable"}`).
		answer("service status", 0, runningWithCtl).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)

	connection, err := app.ConnectLocal()
	if err != nil {
		t.Fatal(err)
	}
	if connection.StartedByApp {
		t.Fatal("an instance someone else started reads as started by the app")
	}
}

func TestConnectLocalReportsTheCLIsErrorWhenStartingFails(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 1, `{"error":"starting proxy listener: address already in use"}`)
	app := localApp(t, cli)

	_, err := app.ConnectLocal()
	if err == nil || !strings.Contains(err.Error(), "address already in use") || !strings.Contains(err.Error(), "instance_failed") {
		t.Fatalf("err = %v, want the CLI's error with the instance_failed code", err)
	}
}

func TestConnectLocalReportsAMissingCLI(t *testing.T) {
	cli := &fakeCLI{}
	app := localApp(t, cli)
	app.findCLI = func() (string, error) { return "", errors.New(`exec: "marasi": executable file not found in $PATH`) }

	_, err := app.ConnectLocal()
	if err == nil || !strings.Contains(err.Error(), "cli_missing") {
		t.Fatalf("err = %v, want the cli_missing code", err)
	}
	if len(cli.calls) != 0 {
		t.Fatalf("ran the CLI %v without one", cli.subcommands())
	}
}

func TestQuitStopsTheLocalInstanceOnlyWhenTheAppStartedIt(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    string
		exit      int
		wantStops int
	}{
		{name: "started by the app", status: notRunning, exit: 1, wantStops: 1},
		{name: "attached", status: runningWithCtl, exit: 0, wantStops: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cli := (&fakeCLI{}).
				answer("service status", tc.exit, tc.status).
				answer("service start", 0, started).
				answer("service control pair", 0, paired).
				answer("service stop", 0, stopped)
			app := newTestApp(t)
			app.runCLI = cli.run
			app.findCLI = func() (string, error) { return "/bin/marasi", nil }
			app.newPassword = func() (string, error) { return "generated", nil }
			if _, err := app.ConnectLocal(); err != nil {
				t.Fatal(err)
			}

			app.ServiceShutdown()

			stops := 0
			for _, name := range cli.subcommands() {
				if name == "service stop" {
					stops++
				}
			}
			if stops != tc.wantStops {
				t.Fatalf("stopped the instance %d times, want %d (calls %v)", stops, tc.wantStops, cli.subcommands())
			}
		})
	}
}

func TestQuitBeforeConnectingStopsNothing(t *testing.T) {
	cli := &fakeCLI{}
	app := localApp(t, cli)

	if err := app.stopOwnedLocal(); err != nil {
		t.Fatal(err)
	}
	if len(cli.calls) != 0 {
		t.Fatalf("ran the CLI %v before connecting", cli.subcommands())
	}
}

func TestEveryCLICallUsesTheConfigDirOverrideAndNoInheritedMarasiVariables(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)
	t.Setenv(cliConfigDirEnv, "/tmp/isolated-marasi")
	t.Setenv("MARASI_INSTANCE", "other")
	t.Setenv("MARASI_PASSWORD", "inherited")
	app.useLocalInstanceRuntime()
	app.runCLI = cli.run
	app.findCLI = func() (string, error) { return "/bin/marasi", nil }
	app.newPassword = func() (string, error) { return "generated", nil }

	if _, err := app.ConnectLocal(); err != nil {
		t.Fatal(err)
	}

	for _, call := range cli.calls {
		if i := slices.Index(call.args, "--config-dir"); i < 0 || call.args[i+1] != "/tmp/isolated-marasi" {
			t.Fatalf("%s args %v lack --config-dir /tmp/isolated-marasi", call.subcommand(), call.args)
		}
		if _, ok := call.envValue("MARASI_INSTANCE"); ok {
			t.Fatalf("%s inherited MARASI_INSTANCE", call.subcommand())
		}
		if password, ok := call.envValue("MARASI_PASSWORD"); ok && password != "generated" {
			t.Fatalf("%s inherited MARASI_PASSWORD=%s", call.subcommand(), password)
		}
	}
}
