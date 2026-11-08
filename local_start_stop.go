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
