//go:build !server || windows

package main

// quitOnSignal does nothing outside the server build: a desktop build quits
// through its menu and window (see server_quit_signal.go).
func quitOnSignal(*App) {}
