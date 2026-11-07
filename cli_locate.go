package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// cliProbeTimeout bounds the `service status` a candidate CLI must answer.
const cliProbeTimeout = 15 * time.Second

// errNoCLI: no Marasi CLI at the custom path or on PATH.
var errNoCLI = errors.New("the Marasi CLI isn't installed: install it, or set its path in Settings → Updates")

// CLIInfo is the Marasi CLI the app uses, for the CLI setup and Settings →
// Updates (its Marasi CLI part).
type CLIInfo struct {
	// Found is false when there is no Marasi CLI; the rest is then empty.
	Found bool   `json:"found"`
	Path  string `json:"path"`
	// Source is where it was found: "custom" (a path the researcher set),
	// "installed" (installed by the app) or "path" (marasi on PATH).
	Source string `json:"source"`
	// Version is the CLI's build version: "DD.MM.YYYY", "DD.MM.YYYY
	// (nightly <sha>)" or "dev".
	Version string `json:"version"`
	// Channel is the channel the CLI was built for, "" for a dev build.
	Channel string `json:"channel"`
	// Problem says why the saved path was passed over, "" when it wasn't.
	Problem string `json:"problem"`
}

// LocateCLI finds the Marasi CLI: the path saved in app config, then marasi
// on PATH. A candidate counts only when it answers like Marasi.
func (a *App) LocateCLI() (CLIInfo, error) {
	var problem string
	if saved := a.savedCLIPath(); saved.Path != "" {
		info, err := a.probeCLI(saved.Path, saved.Source)
		if err == nil {
			return info, nil
		}
		problem = err.Error()
	}
	path, err := a.cliRuntime.lookPath("marasi")
	if err == nil {
		if info, err := a.probeCLI(path, cliSourcePath); err == nil {
			info.Problem = problem
			return info, nil
		}
	}
	return CLIInfo{Problem: problem}, nil
}

// locatedCLIPath is findCLI for the local instance: the located CLI's
// path, or errNoCLI.
func (a *App) locatedCLIPath() (string, error) {
	info, err := a.LocateCLI()
	if err != nil {
		return "", err
	}
	if !info.Found {
		return "", errNoCLI
	}
	return info.Path, nil
}

// UseCLIPath sets path as the Marasi CLI, once it answers like Marasi, and
// saves it in app config. A program that isn't Marasi is refused and
// nothing is saved.
func (a *App) UseCLIPath(path string) (CLIInfo, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return CLIInfo{}, errors.New("enter the Marasi CLI's path")
	}
	info, err := a.probeCLI(path, cliSourceCustom)
	if err != nil {
		return CLIInfo{}, err
	}
	if err := a.Config.setCLIPath(savedCLIPath{Path: path, Source: cliSourceCustom}); err != nil {
		return CLIInfo{}, err
	}
	return info, nil
}

// ClearCLIPath forgets the saved CLI path, so the app goes back to marasi
// on PATH.
func (a *App) ClearCLIPath() (CLIInfo, error) {
	if err := a.Config.setCLIPath(savedCLIPath{}); err != nil {
		return CLIInfo{}, err
	}
	return a.LocateCLI()
}

func (a *App) savedCLIPath() savedCLIPath {
	if a.Config == nil {
		return savedCLIPath{}
	}
	return a.Config.cliPath()
}

// probeCLI runs `service status --json` for the local instance with the
// CLI at path, and accepts it only when it answers as Marasi does: a status
// object on success, or {"error": "..."} with exit 1.
func (a *App) probeCLI(path, source string) (CLIInfo, error) {
	args := []string{"--instance", localInstanceName}
	if a.cliConfigDir != "" {
		args = append(args, "--config-dir", a.cliConfigDir)
	}
	args = append(args, "service", "status", "--json")
	ctx, cancel := context.WithTimeout(context.Background(), cliProbeTimeout)
	defer cancel()
	stdout, exit, err := a.runCLI(ctx, path, args, cliEnv(os.Environ(), nil))
	if err != nil {
		return CLIInfo{}, fmt.Errorf("%s isn't the Marasi CLI: %w", path, unwrapExecError(err))
	}
	if !answersLikeMarasi(stdout, exit) {
		return CLIInfo{}, fmt.Errorf("%s isn't the Marasi CLI", path)
	}
	info := CLIInfo{Found: true, Path: path, Source: source, Version: "dev"}
	if build, err := a.cliRuntime.readBuild(path); err == nil {
		info.Version, info.Channel = build.Version, build.Channel
	}
	return info, nil
}

// answersLikeMarasi reports whether stdout and exit are Marasi's answer to
// `service status --json`: exit 0 with a status object naming its
// instance, or exit 1 with exactly an error object.
func answersLikeMarasi(stdout []byte, exit int) bool {
	switch exit {
	case 0:
		var status struct {
			Status   string `json:"status"`
			Instance string `json:"instance"`
		}
		return json.Unmarshal(stdout, &status) == nil && status.Status != "" && status.Instance != ""
	case 1:
		var failure map[string]json.RawMessage
		if json.Unmarshal(stdout, &failure) != nil || len(failure) != 1 {
			return false
		}
		var message string
		return json.Unmarshal(failure["error"], &message) == nil && message != ""
	}
	return false
}

// unwrapExecError keeps the reason a program could not run, without the
// "fork/exec <path>:" prefix.
func unwrapExecError(err error) error {
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		return pathErr.Err
	}
	return err
}

// BrowseCLIPath asks for the Marasi CLI with the file dialog and returns
// the chosen path, "" when cancelled. UseCLIPath checks and saves it.
func (a *App) BrowseCLIPath() (string, error) {
	return a.openFileDialog(openDialogOptions{Title: "Choose the Marasi CLI"})
}
