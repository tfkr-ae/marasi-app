package main

import (
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// emitFunc sends a Wails event to the frontend.
type emitFunc func(name string, data ...any)

// useDesktopRuntime points App's replaceable desktop functions at the Wails
// runtime. They are the only calls into it: everything else goes through
// them, so tests replace them, and a new Wails runtime changes only this file.
func (a *App) useDesktopRuntime() {
	a.emitEvent = a.emit
	a.quitApp = func() { runtime.Quit(a.ctx) }
	a.messageDialog = nativeMessageDialog(goruntime.GOOS, func(options runtime.MessageDialogOptions) (string, error) {
		return runtime.MessageDialog(a.ctx, options)
	})
	a.openFileDialog = func(options runtime.OpenDialogOptions) (string, error) {
		return runtime.OpenFileDialog(a.ctx, options)
	}
	a.saveFileDialog = func(options runtime.SaveDialogOptions) (string, error) {
		return runtime.SaveFileDialog(a.ctx, options)
	}
	a.setClipboardText = func(text string) error {
		return runtime.ClipboardSetText(a.ctx, text)
	}
	a.onEvent = func(name string, handle func(payload any)) {
		runtime.EventsOff(a.ctx, name)
		runtime.EventsOn(a.ctx, name, func(data ...any) {
			var payload any
			if len(data) > 0 {
				payload = data[0]
			}
			handle(payload)
		})
	}
}

// emit sends a Wails event once startup has given the app its context. Events
// fired before then have no frontend to reach and are dropped.
func (a *App) emit(name string, data ...any) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, name, data...)
}
