//go:build !windows

package main

// handleWailsError leaves Wails' errors to its logger.
var handleWailsError func(error)
