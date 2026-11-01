package main

import (
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// nativeMessageDialog adapts message dialogs to what goos can draw. Only
// macOS shows custom buttons: Wails on Windows and Linux ignores Buttons and
// draws a warning with a lone OK, which answers neither Cancel nor the
// action, so a confirmation could never be confirmed. There a two-button
// confirmation becomes a Yes/No question, and Yes answers as the action.
func nativeMessageDialog(goos string, show func(runtime.MessageDialogOptions) (string, error)) func(runtime.MessageDialogOptions) (string, error) {
	if goos == "darwin" {
		return show
	}
	return func(options runtime.MessageDialogOptions) (string, error) {
		action, ok := confirmAction(options)
		if !ok {
			return show(options)
		}
		question := options
		question.Type = runtime.QuestionDialog
		question.Buttons = nil
		question.DefaultButton = "Yes"
		question.CancelButton = "No"
		if options.DefaultButton == options.CancelButton {
			question.DefaultButton = "No"
		}
		result, err := show(question)
		if err != nil {
			return "", err
		}
		if result == "Yes" {
			return action, nil
		}
		return options.CancelButton, nil
	}
}

// confirmAction returns the button that is not the cancel button of a
// Cancel-and-action confirmation, or false for any other dialog.
func confirmAction(options runtime.MessageDialogOptions) (string, bool) {
	if len(options.Buttons) != 2 || options.CancelButton == "" {
		return "", false
	}
	for i, button := range options.Buttons {
		if button == options.CancelButton {
			return options.Buttons[1-i], true
		}
	}
	return "", false
}
