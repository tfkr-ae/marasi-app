package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Local connections' instances: each local connection names a service
// instance of the Marasi CLI on this machine (Local is `default`). The app
// starts it when it isn't running and attaches when it is, and stops it on
// quit only when the run there is one the app started (owned_runs.go).
// Every call goes through the replaceable runCLI, findCLI and newPassword.

// cliConfigDirEnv names the environment variable that points every CLI call
// at another Marasi config directory (passed as --config-dir), so
// verification never touches the researcher's own instance.
const cliConfigDirEnv = "MARASI_APP_CLI_CONFIG_DIR"

// localInstanceName is the instance the Local connection reaches.
const localInstanceName = "default"

// cliTimeout bounds one CLI call. Starting an instance opens its project,
// which can take a while on a large one.
const cliTimeout = 2 * time.Minute

// runCLIFunc runs the Marasi CLI at path with args and the environment env,
// and returns its stdout and exit code. err is set only when it couldn't run.
type runCLIFunc func(ctx context.Context, path string, args, env []string) (stdout []byte, exitCode int, err error)

// LocalConnection is what the frontend needs to reach the local instance's
// control API.
type LocalConnection struct {
	// URL is the control listener network address, such as
	// http://127.0.0.1:51391.
	URL string `json:"url"`
	// Password is the control password, "" when the instance has none.
	Password string `json:"password"`
	Instance string `json:"instance"`
	// StartedByApp is true when the instance's current run is the one the
	// app started, so it stops it on quit.
	StartedByApp bool `json:"startedByApp"`
}

// localInstance is the app's handle on one local connection's instance.
// Its mutex serializes the CLI calls that act on that instance.
type localInstance struct {
	mu sync.Mutex
	// connection is the local connection's id, which keys its owned run.
	connection string
	// name is the instance the connection names, passed as --instance.
	name string
	// port is the proxy port an added local connection starts on: its saved
	// port, or "0" for any free one. "" is Local's: the app's default
	// listener (listenerDefaults), moving to a free port when it is taken.
	port string
	// cliPath is the CLI the instance was last reached with, for stopping it.
	cliPath string
}

// localInstanceFor is the instance local connection id names and the proxy
// port it starts on (see localInstance.port): Local's `default`, or a saved
// local connection's instance; an error when id isn't a local connection.
func (a *App) localInstanceFor(id string) (name, port string, err error) {
	if id == localConnectionID {
		return localInstanceName, "", nil
	}
	if a.Config == nil {
		return "", "", fmt.Errorf("no local connection %s", id)
	}
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	i, err := a.savedConnection(id, "local")
	if err != nil {
		return "", "", err
	}
	c := a.Config.connections[i]
	return c.Instance, strconv.Itoa(c.Port), nil
}

// localFor is the handle on local connection id's instance.
func (a *App) localFor(id string) (*localInstance, error) {
	name, port, err := a.localInstanceFor(id)
	if err != nil {
		return nil, err
	}
	a.localsMu.Lock()
	defer a.localsMu.Unlock()
	if a.locals == nil {
		a.locals = map[string]*localInstance{}
	}
	l := a.locals[id]
	if l == nil || l.name != name {
		l = &localInstance{connection: id, name: name}
		a.locals[id] = l
	}
	l.mu.Lock()
	l.port = port
	l.mu.Unlock()
	return l, nil
}

// findCLIFor finds the CLI and keeps it as the instance's. Callers hold l.mu.
func (a *App) findCLIFor(l *localInstance) error {
	path, err := a.findCLI()
	if err != nil {
		return codedError("finding the Marasi CLI", codeCLIMissing, nil, err)
	}
	l.cliPath = path
	return nil
}

// useLocalInstanceRuntime points the local instance's replaceable functions
// at the real CLI (the custom path, then PATH: cli_locate.go) and reads the
// config-dir override.
func (a *App) useLocalInstanceRuntime() {
	a.useCLIRuntime()
	a.runCLI = runCLI
	a.findCLI = a.locatedCLIPath
	a.newPassword = generatePassword
	a.cliConfigDir = os.Getenv(cliConfigDirEnv)
	a.localProxyListener = a.readLocalProxyListener
}

// ConnectLocal reaches local connection id's instance and returns its
// control address and password: it starts the instance with a control
// listener on 127.0.0.1:0 and a generated password when it isn't running,
// and when it is, attaches, turning a control listener on when it has none.
// StartedByApp says whether the run there is the app's (saved ownership,
// owned_runs.go): one it started now or in an earlier launch.
func (a *App) ConnectLocal(id string) (LocalConnection, error) {
	l, err := a.localFor(id)
	if err != nil {
		return LocalConnection{}, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := a.findCLIFor(l); err != nil {
		return LocalConnection{}, err
	}

	status, running, err := a.localStatus(l)
	if err != nil {
		return LocalConnection{}, err
	}
	owned := running && a.ownsRun(id, status.RunID)
	if !running {
		// The run the app may have owned is gone.
		a.ownsRun(id, "")
		startErr := a.startLocal(l)
		if startErr != nil && !strings.Contains(startErr.Error(), "already running") {
			return LocalConnection{}, codedError("starting the local instance", codeInstanceFailed, nil, startErr)
		}
		if startErr != nil {
			// Someone else started it since the status: attach to theirs.
			if status, running, err = a.localStatus(l); err != nil {
				return LocalConnection{}, err
			}
		}
		owned = startErr == nil && a.savedOwnedRun(id) != ""
	}
	if running && status.ControlListener == nil {
		password, err := a.newPassword()
		if err != nil {
			return LocalConnection{}, err
		}
		if err := a.cli(l, []string{"MARASI_PASSWORD=" + password}, nil,
			"service", "control", "start", "--address", "127.0.0.1", "--port", "0"); err != nil {
			return LocalConnection{}, instanceError("turning on the local instance's control listener", status, err)
		}
	}

	var pair Pairing
	if err := a.cli(l, nil, &pair, "service", "control", "pair"); err != nil {
		return LocalConnection{}, instanceError("reading the local instance's address", status, err)
	}
	return LocalConnection{URL: pair.URL, Password: pair.Password, Instance: pair.Instance, StartedByApp: owned}, nil
}

// Pairing is what another client needs to reach the local instance's control
// listener: its URL, the control password ("" when none) and the instance.
type Pairing struct {
	URL      string `json:"url"`
	Password string `json:"password"`
	Instance string `json:"instance"`
}

// LocalPairing reads local connection id's pairing payload, which the
// service hands out only on its socket (`service control pair`). The
// frontend puts a host override into it itself, as the CLI's --host does.
func (a *App) LocalPairing(id string) (Pairing, error) {
	l, err := a.localFor(id)
	if err != nil {
		return Pairing{}, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cliPath == "" {
		if err := a.findCLIFor(l); err != nil {
			return Pairing{}, err
		}
	}
	var pairing Pairing
	if err := a.cli(l, nil, &pairing, "service", "control", "pair"); err != nil {
		return Pairing{}, fmt.Errorf("reading the pairing payload: %w", err)
	}
	return pairing, nil
}

// instanceError is err from a control route of the running instance: an
// instance_outdated error naming its version when the instance is too old
// to serve the route (it answers 404), else instance_failed.
func instanceError(what string, status localInstanceStatus, err error) error {
	if !strings.Contains(err.Error(), "404 Not Found") {
		return codedError(what, codeInstanceFailed, nil, err)
	}
	version := status.Version
	if version == "" {
		version = "unknown"
	}
	return codedError(what, codeInstanceOutdated, nil,
		fmt.Errorf("Marasi %s is running, older than this app needs: %w", version, err))
}

// RestartLocalInstance stops local connection id's running instance, which
// another program may have started, and starts it again with the app's CLI
// on the same project, so the app owns the new run (and stops it on quit).
// The frontend confirms first and connects afterwards (ConnectLocal).
func (a *App) RestartLocalInstance(id string) error {
	l, err := a.localFor(id)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := a.findCLIFor(l); err != nil {
		return err
	}
	status, running, err := a.localStatus(l)
	if err != nil {
		return err
	}
	var extra []string
	if running {
		if err := a.cli(l, nil, nil, "service", "stop"); err != nil {
			return codedError("stopping the local instance", codeInstanceFailed, nil, err)
		}
		if status.Project != "" {
			extra = []string{"--project", status.Project}
		}
	}
	a.saveOwnedRun(id, "")
	if err := a.startLocal(l, extra...); err != nil {
		return codedError("starting the local instance", codeInstanceFailed, nil, err)
	}
	return nil
}

// localInstanceStatus is the part of `service status` the app reads.
type localInstanceStatus struct {
	Version         string  `json:"version"`
	Project         string  `json:"project"`
	ControlListener *string `json:"control_listener"`
	ProxyListener   *string `json:"proxy_listener"`
	// RunID is new on every start of the service process (API level 1).
	RunID string `json:"run_id"`
}

// localStatus reads the instance's status; running is false when the CLI
// says it is not running.
func (a *App) localStatus(l *localInstance) (status localInstanceStatus, running bool, err error) {
	if err := a.cli(l, nil, &status, "service", "status"); err != nil {
		if strings.Contains(err.Error(), "is not running") {
			return status, false, nil
		}
		return status, false, codedError("reading the local instance", codeInstanceFailed, nil, err)
	}
	return status, true, nil
}

// startLocal starts the instance with the proxy on the app's default
// address (default_address) and, for Local, its default port (default_port),
// or a free port of the same address when that port is taken; an added local
// connection starts on its saved port, or any free one when it has none.
// It gives a control listener on a free loopback port and a generated
// password, and saves the new run as the app's owned run on its connection.
// Starting an instance that has never run creates it. An added local
// connection without --project in extra opens the project named for its
// instance (--project-name), not the scratchpad. extra are more
// `service start` flags, such as --project.
func (a *App) startLocal(l *localInstance, extra ...string) error {
	password, err := a.newPassword()
	if err != nil {
		return err
	}
	address, port := a.listenerDefaults()
	fixed := l.port != ""
	if fixed {
		port = l.port
		if !slices.Contains(extra, "--project") {
			// Marasi's own pick is the scratchpad, which Local's instance
			// holds open; an added instance opens one named for it.
			extra = append([]string{"--project-name", l.name}, extra...)
		}
	}
	var started struct {
		ProxyListener string `json:"proxy_listener"`
	}
	start := func(port string) error {
		args := append([]string{"service", "start", "--address", address, "--port", port, "--control-address", "127.0.0.1:0"}, extra...)
		return a.cli(l, []string{"MARASI_PASSWORD=" + password}, &started, args...)
	}
	err = start(port)
	if err != nil && !fixed && port != "0" && portTaken(err) {
		log.Printf("[*] proxy port %s:%s is taken, starting the local instance on a free port", address, port)
		err = start("0")
	}
	if err != nil {
		return err
	}
	log.Printf("[*] started local instance %s, proxy on %s", l.name, started.ProxyListener)
	// `service start` doesn't say which run it started; the status does. A
	// run without an ID can't be told from a replacement, so the app doesn't
	// own it and quit leaves it running.
	owned := ""
	status, running, err := a.localStatus(l)
	switch {
	case err != nil:
		log.Printf("reading the local instance the app started: %v", err)
	case running:
		owned = status.RunID
	}
	a.saveOwnedRun(l.connection, owned)
	return nil
}

// listenerDefaults is the proxy listener the app starts the local instance
// on: default_address and default_port in app config, else 127.0.0.1:8080.
func (a *App) listenerDefaults() (address, port string) {
	address, port = "127.0.0.1", "8080"
	if a.Config != nil {
		if a.Config.DefaultAddress != "" {
			address = a.Config.DefaultAddress
		}
		if a.Config.DefaultPort != "" {
			port = a.Config.DefaultPort
		}
	}
	return address, port
}

// portTaken reports whether a start failed because the proxy port is in use
// (EADDRINUSE on Unix, WSAEADDRINUSE on Windows).
func portTaken(err error) bool {
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "address already in use") || strings.Contains(text, "only one usage of each socket address")
}

// stopOwnedRuns stops every local connection's instance whose current run
// is the app's owned run there, including one an earlier launch started,
// and leaves any other run (one the app attached to, or another client's
// replacement) running.
func (a *App) stopOwnedRuns() error {
	var errs []error
	for _, id := range a.ownedRunConnections() {
		if err := a.stopOwnedRun(id); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// stopOwnedRun stops local connection id's instance when its current run is
// the app's owned run there, and clears the record.
func (a *App) stopOwnedRun(id string) error {
	l, err := a.localFor(id)
	if err != nil {
		// No such local connection any more: its record means nothing.
		a.saveOwnedRun(id, "")
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if a.savedOwnedRun(id) == "" {
		return nil
	}
	if l.cliPath == "" {
		if err := a.findCLIFor(l); err != nil {
			return fmt.Errorf("stopping local instance %s: %w", l.name, err)
		}
	}
	status, running, err := a.localStatus(l)
	if err != nil {
		return fmt.Errorf("checking local instance %s before stopping it: %w", l.name, err)
	}
	if !a.ownsRun(id, runIDIf(running, status)) {
		return nil
	}
	if err := a.cli(l, nil, nil, "service", "stop"); err != nil {
		return fmt.Errorf("stopping local instance %s: %w", l.name, err)
	}
	a.saveOwnedRun(id, "")
	return nil
}

// runIDIf is status's run_id when the instance is running, else "".
func runIDIf(running bool, status localInstanceStatus) string {
	if !running {
		return ""
	}
	return status.RunID
}

// cli runs a CLI command with --json for instance l, through the CLI at
// l.cliPath, with extraEnv on top of the app's environment minus any MARASI_
// variable, and decodes a success into out (when not nil). A failure is the
// CLI's error message.
func (a *App) cli(l *localInstance, extraEnv []string, out any, command ...string) error {
	path := l.cliPath
	var args []string
	if l.name != "" {
		args = []string{"--instance", l.name}
	}
	if a.cliConfigDir != "" {
		args = append(args, "--config-dir", a.cliConfigDir)
	}
	args = append(append(args, command...), "--json")
	ctx, cancel := context.WithTimeout(context.Background(), cliTimeout)
	defer cancel()
	stdout, exit, err := a.runCLI(ctx, path, args, cliEnv(os.Environ(), extraEnv))
	if err != nil {
		return err
	}
	if exit != 0 {
		var failure struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(stdout, &failure) == nil && failure.Error != "" {
			return errors.New(failure.Error)
		}
		return fmt.Errorf("%s exited with %d: %s", strings.Join(command, " "), exit, strings.TrimSpace(string(stdout)))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(stdout, out); err != nil {
		return fmt.Errorf("reading %s: %w", strings.Join(command, " "), err)
	}
	return nil
}

// cliEnv is environ without MARASI_ variables, which would otherwise pick
// another instance, config dir or password, plus extra.
func cliEnv(environ, extra []string) []string {
	env := make([]string, 0, len(environ)+len(extra))
	for _, entry := range environ {
		if !strings.HasPrefix(entry, "MARASI_") {
			env = append(env, entry)
		}
	}
	return append(env, extra...)
}

// runCLI runs the CLI and returns its stdout and exit code. Its stderr goes
// with stdout when stdout is empty, so a failure that skips the JSON contract
// still says why.
func runCLI(ctx context.Context, path string, args, env []string) ([]byte, int, error) {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		out := stdout.Bytes()
		if len(bytes.TrimSpace(out)) == 0 {
			out = stderr.Bytes()
		}
		return out, exit.ExitCode(), nil
	}
	if err != nil {
		return nil, 0, err
	}
	return stdout.Bytes(), 0, nil
}

// generatePassword is a random control password: URL-safe base64, so it has
// no whitespace or control characters, which the service refuses.
func generatePassword() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generating the control password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// readLocalProxyListener returns the Local connection's proxy listener
// ("host:port"), or "" when the CLI, the instance or its listener isn't
// there. It never starts anything.
func (a *App) readLocalProxyListener() string {
	path, err := a.findCLI()
	if err != nil {
		return ""
	}
	status, running, err := a.localStatus(&localInstance{connection: localConnectionID, name: localInstanceName, cliPath: path})
	if err != nil || !running || status.ProxyListener == nil {
		return ""
	}
	return *status.ProxyListener
}
