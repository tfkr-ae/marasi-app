//go:build ios || android

package main

// mobileApp: the iOS and Android apps run no app updater and no Marasi CLI
// of their own; they pair with a remote service (platform_desktop.go).
const mobileApp = true
