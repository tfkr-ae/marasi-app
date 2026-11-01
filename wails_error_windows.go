package main

import (
	"errors"
	"log"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// handleWailsError receives Wails' errors. Without the WebView2 runtime the
// window can't open and Wails exits; Marasi says why first, since it ships
// without a WebView2 installer.
func handleWailsError(err error) {
	log.Println(err)
	var fatal *application.FatalError
	if errors.As(err, &fatal) && strings.Contains(err.Error(), "WebView2") {
		w32.MessageBox(0, webView2MissingMessage, "Marasi", w32.MB_OK|w32.MB_ICONERROR)
	}
}

const webView2MissingMessage = "Marasi needs the Microsoft Edge WebView2 Runtime, which isn't installed.\n\n" +
	"Install it from https://developer.microsoft.com/microsoft-edge/webview2/, then open Marasi again."
