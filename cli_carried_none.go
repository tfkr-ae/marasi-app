//go:build !(carried_cli && ((darwin && arm64) || (linux && amd64) || (windows && amd64)))

package main

// A build without the carried_cli tag, such as a development build, or a
// platform Marasi publishes no CLI for, carries no CLI (cli_carried.go).
var carriedCLIGzipped, carriedCLIRecord []byte
