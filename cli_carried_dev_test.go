//go:build !carried_cli

package main

import "testing"

func TestADevelopmentBuildCarriesNoCLI(t *testing.T) {
	app := &App{}
	app.useCLIRuntime()
	if app.cliRuntime.carried != nil {
		t.Fatalf("a build without the carried_cli tag carries %+v", app.cliRuntime.carried)
	}
}
