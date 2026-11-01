package main

import (
	"errors"
	goruntime "runtime"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// emitFunc sends a Wails event to the frontend.
type emitFunc func(name string, data ...any)

// useDesktopRuntime points App's replaceable desktop functions at the Wails
// application in a.wails. They are the only calls into it: everything else
// goes through them, so tests replace them, and a new Wails version changes
// only this file.
func (a *App) useDesktopRuntime() {
	a.emitEvent = a.emit
	a.quitApp = func() { a.wails.Quit() }
	a.messageDialog = nativeMessageDialog(goruntime.GOOS, a.showMessageDialog)
	a.openFileDialog = func(options openDialogOptions) (string, error) {
		return fileDialogResult(a.wails.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
			Title:   options.Title,
			Filters: wailsFileFilters(options.Filters),
		}).PromptForSingleSelection())
	}
	a.saveFileDialog = func(options saveDialogOptions) (string, error) {
		return fileDialogResult(a.wails.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
			Title:     options.Title,
			Directory: options.DefaultDirectory,
			Filename:  options.DefaultFilename,
			Filters:   wailsFileFilters(options.Filters),
		}).PromptForSingleSelection())
	}
	a.setClipboardText = func(text string) error {
		if !a.wails.Clipboard.SetText(text) {
			return errors.New("copying to the clipboard failed")
		}
		return nil
	}
	a.onEvent = func(name string, handle func(payload any)) {
		a.wails.Event.Off(name)
		a.wails.Event.On(name, func(event *application.CustomEvent) {
			handle(event.Data)
		})
	}
}

// emit sends a Wails event once main has given the app its Wails
// application. Without one there is no frontend to reach, and the event is
// dropped.
func (a *App) emit(name string, data ...any) {
	if a.wails == nil {
		return
	}
	a.wails.Event.Emit(name, data...)
}

// showMessageDialog shows a message dialog and waits for the pressed button.
// Wails reports it only through the button's callback. The dialog is not
// attached to the window: on macOS that makes it a sheet, which returns
// before the click.
func (a *App) showMessageDialog(options messageDialogOptions) (string, error) {
	if serverBuild {
		// The server build has no native dialogs, and no callback would come.
		return dismissedButton(options), nil
	}
	var dialog *application.MessageDialog
	switch options.Type {
	case questionDialog:
		dialog = a.wails.Dialog.Question()
	case warningDialog:
		dialog = a.wails.Dialog.Warning()
	default:
		dialog = a.wails.Dialog.Info()
	}
	dialog.SetTitle(options.Title).SetMessage(options.Message)
	labels := dialogButtons(options)
	if goruntime.GOOS == "darwin" {
		// Wails on macOS adds the buttons last first; reversing them keeps
		// the order Marasi has always shown.
		labels = slices.Clone(labels)
		slices.Reverse(labels)
	}
	// On macOS and Windows the callback runs before Show returns, so the
	// channel has room for the answer.
	pressed := make(chan string, 1)
	for _, label := range labels {
		button := dialog.AddButton(label).OnClick(func() {
			select {
			case pressed <- label:
			default:
			}
		})
		if label == options.DefaultButton {
			button.SetAsDefault()
		}
		if label == options.CancelButton {
			button.SetAsCancel()
		}
	}
	dialog.Show()
	return <-pressed, nil
}

func wailsFileFilters(filters []fileFilter) []application.FileFilter {
	converted := make([]application.FileFilter, len(filters))
	for i, filter := range filters {
		converted[i] = application.FileFilter{DisplayName: filter.DisplayName, Pattern: filter.Pattern}
	}
	return converted
}
