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
	app := newTestApp(t)
	app.runCLI = cli.run
	app.findCLI = func() (string, error) { return "/bin/marasi", nil }
	app.newPassword = func() (string, error) { return "generated", nil }
	return app
}

func TestConnectLocalStartsTheInstanceWhenItIsNotRunning(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)

	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}

	if want := []string{"service status", "service start", "service status", "service control pair"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	start := cli.lastCall("service start")
	if start.path != "/bin/marasi" {
		t.Fatalf("ran %q, want the CLI found", start.path)
	}
	for _, flag := range [][]string{{"--address", "127.0.0.1"}, {"--port", "8080"}, {"--control-address", "127.0.0.1:0"}, {"--instance", "default"}} {
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

	connection, err := app.ConnectLocal(localConnectionID)
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

	connection, err := app.ConnectLocal(localConnectionID)
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

	connection, err := app.ConnectLocal(localConnectionID)
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

	_, err := app.ConnectLocal(localConnectionID)
	if err == nil || !strings.Contains(err.Error(), "address already in use") || !strings.Contains(err.Error(), "instance_failed") {
		t.Fatalf("err = %v, want the CLI's error with the instance_failed code", err)
	}
}

func TestConnectLocalReportsAMissingCLI(t *testing.T) {
	cli := &fakeCLI{}
	app := localApp(t, cli)
	app.findCLI = func() (string, error) { return "", errors.New(`exec: "marasi": executable file not found in $PATH`) }

	_, err := app.ConnectLocal(localConnectionID)
	if err == nil || !strings.Contains(err.Error(), "cli_missing") {
		t.Fatalf("err = %v, want the cli_missing code", err)
	}
	if len(cli.calls) != 0 {
		t.Fatalf("ran the CLI %v without one", cli.subcommands())
	}
}

// runOf is a running status of the instance's run runID, with a control
// listener.
func runOf(runID string) string {
	return `{"status":"running","version":"dev","api":1,"instance":"default","project":"/p/scratchpad.marasi","proxy_listener":"127.0.0.1:8080","control_listener":"127.0.0.1:52001","run_id":"` + runID + `"}`
}

func (f *fakeCLI) stops() int {
	stops := 0
	for _, name := range f.subcommands() {
		if name == "service stop" {
			stops++
		}
	}
	return stops
}

// quittingApp is an App on cli, as main builds it, so ServiceShutdown runs
// the quit path.
func quittingApp(t *testing.T, cli *fakeCLI) *App {
	t.Helper()
	app := newTestApp(t)
	app.runCLI = cli.run
	app.findCLI = func() (string, error) { return "/bin/marasi", nil }
	app.newPassword = func() (string, error) { return "generated", nil }
	return app
}

func TestQuitStopsTheRunTheAppStarted(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if !connection.StartedByApp {
		t.Fatal("the instance the app started doesn't read as the app's")
	}

	app.ServiceShutdown()

	if cli.stops() != 1 {
		t.Fatalf("stopped the instance %d times, want once (calls %v)", cli.stops(), cli.subcommands())
	}
}

func TestQuitLeavesAnInstanceTheAppAttachedToRunning(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runOf("run-other")).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.StartedByApp {
		t.Fatal("an instance the app attached to reads as the app's")
	}

	app.ServiceShutdown()

	if cli.stops() != 0 {
		t.Fatalf("stopped an instance the app attached to (calls %v)", cli.subcommands())
	}
}

func TestQuitLeavesAReplacementAnotherClientStartedRunning(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		// Another client stops the app's run and starts its own.
		answer("service status", 0, runOf("run-other")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}
	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.StartedByApp {
		t.Fatal("another client's replacement reads as the app's")
	}

	app.ServiceShutdown()

	if cli.stops() != 0 {
		t.Fatalf("quitting stopped another client's replacement (calls %v)", cli.subcommands())
	}
}

func TestQuitLeavesAReplacementStartedAfterTheAppLastConnected(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service status", 0, runOf("run-other")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	app.ServiceShutdown()

	if cli.stops() != 0 {
		t.Fatalf("quitting stopped another client's replacement (calls %v)", cli.subcommands())
	}
}

func TestQuitBeforeConnectingStopsNothing(t *testing.T) {
	cli := &fakeCLI{}
	app := localApp(t, cli)

	if err := app.stopOwnedRuns(); err != nil {
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

	if _, err := app.ConnectLocal(localConnectionID); err != nil {
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

// flagValue is the value after flag in args, or "" when it isn't there.
func flagValue(args []string, flag string) string {
	if i := slices.Index(args, flag); i >= 0 && i+1 < len(args) {
		return args[i+1]
	}
	return ""
}

// startCalls is every `service start` call, in order.
func (f *fakeCLI) startCalls() []cliCall {
	var calls []cliCall
	for _, call := range f.calls {
		if call.subcommand() == "service start" {
			calls = append(calls, call)
		}
	}
	return calls
}

func TestConnectLocalStartsTheProxyOnAFreePortWhenTheDefaultIsTaken(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 1, `{"error":"binding proxy listener on address 127.0.0.1 port 8080: setting up listener on address:port 127.0.0.1:8080: listen tcp 127.0.0.1:8080: bind: address already in use"}`).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := localApp(t, cli)

	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}

	starts := cli.startCalls()
	if len(starts) != 2 {
		t.Fatalf("started %d times, want the default then a free port (calls %v)", len(starts), cli.subcommands())
	}
	if port := flagValue(starts[0].args, "--port"); port != "8080" {
		t.Fatalf("first start on port %q, want 8080", port)
	}
	if port, address := flagValue(starts[1].args, "--port"), flagValue(starts[1].args, "--address"); port != "0" || address != "127.0.0.1" {
		t.Fatalf("retry on %s:%s, want 127.0.0.1:0", address, port)
	}
	if !connection.StartedByApp {
		t.Fatal("the instance started on a free port doesn't read as the app's")
	}
}

func TestConnectLocalStartsTheProxyOnTheConfiguredDefaultListener(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := newTestApp(t)
	app.runCLI = cli.run
	app.findCLI = func() (string, error) { return "/bin/marasi", nil }
	app.newPassword = func() (string, error) { return "generated", nil }
	if _, err := app.SetFlag("default_port", "9090"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.SetFlag("default_address", "0.0.0.0"); err != nil {
		t.Fatal(err)
	}

	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	start := cli.lastCall("service start")
	if port, address := flagValue(start.args, "--port"), flagValue(start.args, "--address"); port != "9090" || address != "0.0.0.0" {
		t.Fatalf("started on %s:%s, want 0.0.0.0:9090", address, port)
	}
	if len(cli.startCalls()) != 1 {
		t.Fatalf("started %d times, want once", len(cli.startCalls()))
	}
}

func TestConnectLocalDoesNotRetryAStartThatFailedForAnotherReason(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service start", 1, `{"error":"opening project: database is locked"}`)
	app := localApp(t, cli)

	if _, err := app.ConnectLocal(localConnectionID); err == nil || !strings.Contains(err.Error(), "database is locked") {
		t.Fatalf("err = %v, want the CLI's error", err)
	}
	if len(cli.startCalls()) != 1 {
		t.Fatalf("started %d times, want once", len(cli.startCalls()))
	}
}

// runningOld is the status of an instance an old Marasi build runs, which
// has no pairing route.
const runningOld = `{"status":"running","version":"v2-backlog-3a55b06 (dev)","instance":"default","project":"/p/engagement.marasi","proxy_listener":"127.0.0.1:8080","control_listener":"127.0.0.1:51391"}`

func TestConnectLocalSaysARunningInstanceWithoutPairingIsOutdated(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runningOld).
		answer("service control pair", 1, `{"error":"reading pairing: 404 Not Found"}`)
	app := localApp(t, cli)

	_, err := app.ConnectLocal(localConnectionID)

	if err == nil || !strings.Contains(err.Error(), "instance_outdated") {
		t.Fatalf("err = %v, want the instance_outdated code", err)
	}
	if !strings.Contains(err.Error(), "Marasi v2-backlog-3a55b06 (dev) is running, older than this app needs") {
		t.Fatalf("err = %v, want it to name the running version", err)
	}
}

func TestConnectLocalReportsOtherPairingFailuresAsInstanceFailed(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runningWithCtl).
		answer("service control pair", 1, `{"error":"connecting to instance socket: connection refused"}`)
	app := localApp(t, cli)

	_, err := app.ConnectLocal(localConnectionID)
	if err == nil || !strings.Contains(err.Error(), "instance_failed") || strings.Contains(err.Error(), "instance_outdated") {
		t.Fatalf("err = %v, want instance_failed", err)
	}
}

func TestRestartLocalInstanceStopsTheRunningOneAndStartsItsProjectWithTheAppsCLI(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runningOld).
		answer("service status", 0, runOf("run-restarted")).
		answer("service stop", 0, stopped).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)

	if err := app.RestartLocalInstance(localConnectionID); err != nil {
		t.Fatal(err)
	}

	if want := []string{"service status", "service stop", "service start", "service status"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	start := cli.lastCall("service start")
	if start.path != "/bin/marasi" {
		t.Fatalf("started with %q, want the app's CLI", start.path)
	}
	if project := flagValue(start.args, "--project"); project != "/p/engagement.marasi" {
		t.Fatalf("started project %q, want the old instance's", project)
	}
	if port := flagValue(start.args, "--port"); port != "8080" {
		t.Fatalf("started on port %q, want the default", port)
	}

	connection, err := app.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if !connection.StartedByApp {
		t.Fatal("the restarted instance doesn't read as the app's")
	}
	app.ServiceShutdown()
	if cli.stops() != 2 {
		t.Fatalf("calls %v, want the restarted instance stopped on quit", cli.subcommands())
	}
}

func TestRestartLocalInstanceStartsNothingWhenStoppingFails(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runningOld).
		answer("service stop", 1, `{"error":"stopping instance: 404 Not Found"}`)
	app := localApp(t, cli)

	err := app.RestartLocalInstance(localConnectionID)

	if err == nil || !strings.Contains(err.Error(), "404 Not Found") {
		t.Fatalf("err = %v, want the stop's error", err)
	}
	if len(cli.startCalls()) != 0 {
		t.Fatalf("started an instance while the old one runs: %v", cli.subcommands())
	}
}

func TestRestartLocalInstanceStartsOneThatIsNoLongerRunning(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started)
	app := localApp(t, cli)

	if err := app.RestartLocalInstance(localConnectionID); err != nil {
		t.Fatal(err)
	}
	if want := []string{"service status", "service start", "service status"}; !slices.Equal(cli.subcommands(), want) {
		t.Fatalf("CLI calls = %v, want %v", cli.subcommands(), want)
	}
	if project := flagValue(cli.lastCall("service start").args, "--project"); project != "" {
		t.Fatalf("started project %q, want the default", project)
	}
}

// relaunchedApp is a fresh App over app's config directory, as the next
// launch builds it, on cli.
func relaunchedApp(t *testing.T, app *App, cli *fakeCLI) *App {
	t.Helper()
	next := newApp(app.Config.ConfigDir)
	var err error
	if next.Config, err = LoadConfig(app.Config.ConfigDir); err != nil {
		t.Fatalf("loading app config: %v", err)
	}
	next.runCLI = cli.run
	next.findCLI = func() (string, error) { return "/bin/marasi", nil }
	next.newPassword = func() (string, error) { return "generated", nil }
	return next
}

func TestARelaunchedAppOwnsTheRunAnEarlierLaunchStarted(t *testing.T) {
	first := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := quittingApp(t, first)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	cli := (&fakeCLI{}).
		answer("service status", 0, runOf("run-app")).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	relaunched := relaunchedApp(t, app, cli)
	connection, err := relaunched.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if !connection.StartedByApp {
		t.Fatal("the run an earlier launch started doesn't read as the app's after a relaunch")
	}

	relaunched.ServiceShutdown()

	if cli.stops() != 1 {
		t.Fatalf("stopped the earlier launch's run %d times, want once (calls %v)", cli.stops(), cli.subcommands())
	}
}

func TestAChangedRunClearsTheSavedOwnership(t *testing.T) {
	first := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := quittingApp(t, first)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	// Between launches another client restarts the instance.
	second := (&fakeCLI{}).
		answer("service status", 0, runOf("run-other")).
		answer("service control pair", 0, paired)
	relaunched := relaunchedApp(t, app, second)
	connection, err := relaunched.ConnectLocal(localConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.StartedByApp {
		t.Fatal("another client's run reads as the app's")
	}

	// The record is gone: even the old run coming back isn't the app's.
	third := (&fakeCLI{}).
		answer("service status", 0, runOf("run-app")).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	again := relaunchedApp(t, relaunched, third)
	if connection, err = again.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}
	if connection.StartedByApp {
		t.Fatal("a cleared ownership came back")
	}
	again.ServiceShutdown()
	if third.stops() != 0 {
		t.Fatalf("quitting stopped a run the app no longer owns (calls %v)", third.subcommands())
	}
}

func TestQuitAfterARelaunchLeavesAnotherClientsReplacementRunning(t *testing.T) {
	first := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := quittingApp(t, first)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	// The relaunched app never connects locally (it is on a remote) while
	// another client replaces the run.
	cli := (&fakeCLI{}).
		answer("service status", 0, runOf("run-other")).
		answer("service stop", 0, stopped)
	relaunched := relaunchedApp(t, app, cli)

	relaunched.ServiceShutdown()

	if cli.stops() != 0 {
		t.Fatalf("quitting stopped another client's replacement (calls %v)", cli.subcommands())
	}
}

func TestQuitStopsARunAnEarlierLaunchStartedWithoutConnectingFirst(t *testing.T) {
	first := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired)
	app := quittingApp(t, first)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	cli := (&fakeCLI{}).
		answer("service status", 0, runOf("run-app")).
		answer("service stop", 0, stopped)
	relaunched := relaunchedApp(t, app, cli)

	relaunched.ServiceShutdown()

	if cli.stops() != 1 {
		t.Fatalf("stopped the owned run %d times, want once (calls %v)", cli.stops(), cli.subcommands())
	}
	if instance := flagValue(cli.lastCall("service stop").args, "--instance"); instance != "default" {
		t.Fatalf("stopped instance %q, want default", instance)
	}
}

func TestLocalInstanceOperationsRefuseAConnectionThatIsNotLocal(t *testing.T) {
	cli := &fakeCLI{}
	app := quittingApp(t, cli)

	if _, err := app.ConnectLocal("remote-abc"); err == nil {
		t.Fatal("connected locally through a connection that isn't local")
	}
	if err := app.RestartLocalInstance("remote-abc"); err == nil {
		t.Fatal("restarted through a connection that isn't local")
	}
	if len(cli.calls) != 0 {
		t.Fatalf("ran the CLI %v for a connection that isn't local", cli.subcommands())
	}
}
