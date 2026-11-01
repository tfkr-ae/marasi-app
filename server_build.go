//go:build server

package main

// serverBuild is true in a -tags server build, which serves the app over HTTP
// and has no native dialogs.
const serverBuild = true
