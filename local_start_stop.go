package main

import "strings"

// Stop and Start of a local connection's instance from inside the app. The
// frontend asks before stopping a run the app doesn't own, and connects
// (ConnectLocal) after a start.

// StopLocalInstance stops local connection id's instance (`service stop`),
// whoever started it, and clears the app's owned run there. An instance that
// isn't running is already stopped.
func (a *App) StopLocalInstance(id string) error {
	l, err := a.localFor(id)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := a.findCLIFor(l); err != nil {
		return err
	}
	if err := a.cli(l, nil, nil, "service", "stop"); err != nil && !strings.Contains(err.Error(), "is not running") {
		return codedError("stopping the local instance", codeInstanceFailed, nil, err)
	}
	a.saveOwnedRun(id, "")
	return nil
}

// StartLocalInstance starts local connection id's instance on project ("" for
// the one the service picks) through the connect path's start (startLocal),
// so the app owns the new run. An instance that is already running, such as
// one another client started since the stop, is left for ConnectLocal to
// attach to.
func (a *App) StartLocalInstance(id, project string) error {
	l, err := a.localFor(id)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := a.findCLIFor(l); err != nil {
		return err
	}
	_, running, err := a.localStatus(l)
	if err != nil {
		return err
	}
	if running {
		return nil
	}
	var extra []string
	if project != "" {
		extra = []string{"--project", project}
	}
	if err := a.startLocal(l, extra...); err != nil && !strings.Contains(err.Error(), "already running") {
		return codedError("starting the local instance", codeInstanceFailed, nil, err)
	}
	return nil
}

// LocalInstances lists the instances the Marasi CLI reports on this machine
// (`service list`), running or unhealthy, for the add form. An instance
// that has never run, or is stopped, isn't listed; the form takes a typed
// name for those.
func (a *App) LocalInstances() ([]string, error) {
	path, err := a.findCLI()
	if err != nil {
		return nil, codedError("finding the Marasi CLI", codeCLIMissing, nil, err)
	}
	var list struct {
		Items []struct {
			Instance string `json:"instance"`
		} `json:"items"`
	}
	if err := a.cli(&localInstance{cliPath: path}, nil, &list, "service", "list"); err != nil {
		return nil, codedError("listing the local instances", codeInstanceFailed, nil, err)
	}
	names := make([]string, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Instance != "" {
			names = append(names, item.Instance)
		}
	}
	return names, nil
}
