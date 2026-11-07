package main

import (
	"errors"
	"fmt"
	"os"
	"time"
)

// exeInstaller installs the Windows build, marasi-app.exe, with swapAside:
// the running .exe moves aside to <name>.old and the next launch removes it.
// It is not tied to Windows by a build tag, so tests on any platform can
// install into a temp directory with it.
type exeInstaller struct {
	// binaryInstaller locates, checks and stages the .exe as it does the
	// Linux binary: the build is one file beside which Marasi can write.
	binaryInstaller
}

// exeAsset is the release asset Windows installs.
const exeAsset = "marasi-app.exe"

func (e exeInstaller) asset() string { return exeAsset }

// asideName is where swapAside moves the running build at location.
func asideName(location string) string { return location + ".old" }

func (e exeInstaller) swap(staged, location string) error {
	return swapAside(os.Rename, os.Remove, staged, location)
}

func (e exeInstaller) removeLeftovers(location string) error {
	return removeAside(os.Remove, location)
}

// swapAside installs staged at location while the executable there may be
// running: Windows will not replace or delete a running executable, but it
// will rename one. It moves the build at location aside to asideName, then
// staged into place; when that second move fails it moves the build back,
// so the install is unchanged; with nothing at location it just moves
// staged there. The aside copy stays until removeAside, once its process
// has exited. The app's updater and the CLI's installer both use it.
func swapAside(rename func(from, to string) error, remove func(path string) error, staged, location string) error {
	// A leftover not yet removed would block the move aside; it is older
	// than the build at location, so it can go.
	if err := removeAside(remove, location); err != nil {
		return fmt.Errorf("removing the leftover previous version: %w", err)
	}
	if err := rename(location, asideName(location)); errors.Is(err, os.ErrNotExist) {
		// A first install: nothing to move aside.
		return rename(staged, location)
	} else if err != nil {
		return fmt.Errorf("moving the running build aside: %w", err)
	}
	if err := rename(staged, location); err != nil {
		if restoreErr := rename(asideName(location), location); restoreErr != nil {
			return fmt.Errorf("moving the new build into place: %w (and putting the running build back: %v)", err, restoreErr)
		}
		return fmt.Errorf("moving the new build into place: %w", err)
	}
	return nil
}

// removeAside deletes the previous version swapAside moved aside beside
// location. Nothing to remove is not an error.
func removeAside(remove func(path string) error, location string) error {
	if err := remove(asideName(location)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Removing a leftover is retried for a while: right after a restart the
// previous process may still be exiting and hold its file open.
const (
	leftoverAttempts   = 10
	leftoverRetryDelay = time.Second
)

// retryRemoval runs remove until it succeeds or leftoverAttempts have
// failed, sleeping leftoverRetryDelay between attempts, and returns the last
// error.
func retryRemoval(remove func() error, sleep func(time.Duration)) error {
	var err error
	for attempt := 1; attempt <= leftoverAttempts; attempt++ {
		if err = remove(); err == nil {
			return nil
		}
		if attempt < leftoverAttempts {
			sleep(leftoverRetryDelay)
		}
	}
	return err
}
