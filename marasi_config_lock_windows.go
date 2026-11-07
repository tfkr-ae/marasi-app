//go:build windows

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// Marasi locks the first byte of marasi_config.lock with LockFileEx, so the
// app does the same to exclude the CLI and every service instance.

func tryLockFile(file *os.File) error {
	var overlapped windows.Overlapped
	return windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped)
}

func unlockFile(file *os.File) error {
	var overlapped windows.Overlapped
	return windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, &overlapped)
}

func lockUnavailable(err error) bool {
	return errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}
