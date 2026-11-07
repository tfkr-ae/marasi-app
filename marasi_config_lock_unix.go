//go:build unix

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// Marasi locks marasi_config.lock with flock on the whole file, so the app
// does the same to exclude the CLI and every service instance.

func tryLockFile(file *os.File) error {
	return unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}

func unlockFile(file *os.File) error {
	return unix.Flock(int(file.Fd()), unix.LOCK_UN)
}

func lockUnavailable(err error) bool {
	return errors.Is(err, unix.EWOULDBLOCK)
}
