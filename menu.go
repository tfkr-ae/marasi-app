package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// applicationMenu is the macOS menu bar: the app menu and Edit, which carry
// Quit and the clipboard shortcuts. Wails' default also has File, View,
// Window and Help, whose shortcuts (⌘R reload, ⌘= zoom, ⌘W close) would
// fire over Marasi's own. Other OSes show no menu bar, so it is nil there.
func applicationMenu() *application.Menu {
	if runtime.GOOS != "darwin" {
		return nil
	}
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)
	menu.AddRole(application.EditMenu)
	return menu
}
