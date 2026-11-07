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
	"strings"
	"sync"
	"time"
)

// The local connection's instance: the app reaches the `default` instance of
// the Marasi CLI on this machine, starting it when it isn't running and
// attaching when it is, and stops it on quit only when the app started it.
// Every call goes through the replaceable runCLI, findCLI and newPassword.

// cliConfigDirEnv names the environment variable that points every CLI call
// at another Marasi config directory (passed as --config-dir), so
// verification never touches the researcher's own instance.
const cliConfigDirEnv = "MARASI_APP_CLI_CONFIG_DIR"

// localInstanceName is the instance the local connection reaches.
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
	// StartedByApp is true when the app started the instance, so it stops it
	// on quit.
	StartedByApp bool `json:"startedByApp"`
}

// localInstance is the app's record of the local instance.
type localInstance struct {
	mu sync.Mutex
	// owned is set once the app started the instance.
	owned bool
	// cliPath is the CLI the instance was reached with, for stopping it.
	cliPath string
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

// ConnectLocal reaches the local `default` instance and returns its control
// address and password: it starts the instance with a control listener on
// 127.0.0.1:0 and a generated password when it isn't running, and when it
// is, attaches, turning a control listener on when it has none.
func (a *App) ConnectLocal() (LocalConnection, error) {
	a.local.mu.Lock()
	defer a.local.mu.Unlock()
	path, err := a.findCLI()
	if err != nil {
		return LocalConnection{}, codedError("finding the Marasi CLI", codeCLIMissing, nil, err)
	}
	a.local.cliPath = path

	status, running, err := a.localStatus(path)
	if err != nil {
		return LocalConnection{}, err
	}
	if !running {
		startErr := a.startLocal(path)
		if startErr != nil && !strings.Contains(startErr.Error(), "already running") {
			return LocalConnection{}, codedError("starting the local instance", codeInstanceFailed, nil, startErr)
		}
		if startErr != nil {
			// Someone else started it since the status: attach to theirs.
			if status, running, err = a.localStatus(path); err != nil {
				return LocalConnection{}, err
			}
		}
	}
	if running && status.ControlListener == nil {
		password, err := a.newPassword()
		if err != nil {
			return LocalConnection{}, err
		}
		if err := a.cli(path, []string{"MARASI_PASSWORD=" + password}, nil,
			"service", "control", "start", "--address", "127.0.0.1", "--port", "0"); err != nil {
			return LocalConnection{}, instanceError("turning on the local instance's control listener", status, err)
		}
	}

	var pair Pairing
	if err := a.cli(path, nil, &pair, "service", "control", "pair"); err != nil {
		return LocalConnection{}, instanceError("reading the local instance's address", status, err)
	}
	return LocalConnection{URL: pair.URL, Password: pair.Password, Instance: pair.Instance, StartedByApp: a.local.owned}, nil
}

// Pairing is what another client needs to reach the local instance's control
// listener: its URL, the control password ("" when none) and the instance.
type Pairing struct {
	URL      string `json:"url"`
	Password string `json:"password"`
	Instance string `json:"instance"`
}

// LocalPairing reads the local instance's pairing payload, which the service
// hands out only on its socket (`service control pair`). The frontend puts
// a host override into it itself, as the CLI's --host does.
func (a *App) LocalPairing() (Pairing, error) {
	a.local.mu.Lock()
	defer a.local.mu.Unlock()
	path := a.local.cliPath
	if path == "" {
		found, err := a.findCLI()
		if err != nil {
			return Pairing{}, codedError("finding the Marasi CLI", codeCLIMissing, nil, err)
		}
		path = found
	}
	var pairing Pairing
	if err := a.cli(path, nil, &pairing, "service", "control", "pair"); err != nil {
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

// RestartLocalInstance stops the running local instance, which another
// program may have started, and starts it again with the app's CLI on the
// same project, so the app owns it (and stops it on quit). The frontend
// confirms first and connects afterwards (ConnectLocal).
func (a *App) RestartLocalInstance() error {
	a.local.mu.Lock()
	defer a.local.mu.Unlock()
	path, err := a.findCLI()
	if err != nil {
		return codedError("finding the Marasi CLI", codeCLIMissing, nil, err)
	}
	a.local.cliPath = path
	status, running, err := a.localStatus(path)
	if err != nil {
		return err
	}
	var extra []string
	if running {
		if err := a.cli(path, nil, nil, "service", "stop"); err != nil {
			return codedError("stopping the local instance", codeInstanceFailed, nil, err)
		}
		a.local.owned = false
		if status.Project != "" {
			extra = []string{"--project", status.Project}
		}
	}
	if err := a.startLocal(path, extra...); err != nil {
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
}

// localStatus reads the instance's status; running is false when the CLI
// says it is not running.
func (a *App) localStatus(path string) (status localInstanceStatus, running bool, err error) {
	if err := a.cli(path, nil, &status, "service", "status"); err != nil {
		if strings.Contains(err.Error(), "is not running") {
			return status, false, nil
		}
		return status, false, codedError("reading the local instance", codeInstanceFailed, nil, err)
	}
	return status, true, nil
}

// startLocal starts the instance with the proxy on the app's default
// listener (default_address, default_port), or on a free port of the same
// address when that port is taken, a control listener on a free loopback
// port and a generated password, and records that the app owns it. extra
// are more `service start` flags, such as --project.
func (a *App) startLocal(path string, extra ...string) error {
	password, err := a.newPassword()
	if err != nil {
		return err
	}
	address, port := a.listenerDefaults()
	var started struct {
		ProxyListener string `json:"proxy_listener"`
	}
	start := func(port string) error {
		args := append([]string{"service", "start", "--address", address, "--port", port, "--control-address", "127.0.0.1:0"}, extra...)
		return a.cli(path, []string{"MARASI_PASSWORD=" + password}, &started, args...)
	}
	err = start(port)
	if err != nil && port != "0" && portTaken(err) {
		log.Printf("[*] proxy port %s:%s is taken, starting the local instance on a free port", address, port)
		err = start("0")
	}
	if err != nil {
		return err
	}
	log.Printf("[*] started the local instance, proxy on %s", started.ProxyListener)
	a.local.owned = true
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

// stopOwnedLocal stops the local instance when the app started it, and
// leaves one it attached to running.
func (a *App) stopOwnedLocal() error {
	a.local.mu.Lock()
	defer a.local.mu.Unlock()
	if !a.local.owned {
		return nil
	}
	if err := a.cli(a.local.cliPath, nil, nil, "service", "stop"); err != nil {
		return fmt.Errorf("stopping the local instance: %w", err)
	}
	a.local.owned = false
	return nil
}

// cli runs a CLI command with --json for the local instance, with extraEnv
// on top of the app's environment minus any MARASI_ variable, and decodes a
// success into out (when not nil). A failure is the CLI's error message.
func (a *App) cli(path string, extraEnv []string, out any, command ...string) error {
	args := []string{"--instance", localInstanceName}
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

// readLocalProxyListener returns the local instance's proxy listener
// ("host:port"), or "" when the CLI, the instance or its listener isn't
// there. It never starts anything.
func (a *App) readLocalProxyListener() string {
	path, err := a.findCLI()
	if err != nil {
		return ""
	}
	status, running, err := a.localStatus(path)
	if err != nil || !running || status.ProxyListener == nil {
		return ""
	}
	return *status.ProxyListener
}
