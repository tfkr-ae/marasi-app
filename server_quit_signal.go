//go:build server && !windows

package main

import (
	"os"
	"os/signal"
	"syscall"
)

// quitOnSignal gives the server build, which has no menu or window, a way
// to quit as ⌘Q does: SIGUSR1 asks shouldQuit (so any unsaved-work prompt
// and the quit question come first) and quits when it agrees. Wails' server
// mode never asks ShouldQuit itself. verify-marasi uses it to drive the
// quit question; TERM still shuts down without asking.
func quitOnSignal(app *App) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGUSR1)
	go func() {
		for range signals {
			if app.shouldQuit() {
				app.quitApp()
			}
		}
	}()
}
