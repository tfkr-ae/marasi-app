package main

// dialogType is the kind of message dialog: the icon it shows and, on
// Windows, whether it can draw custom buttons.
type dialogType int

const (
	infoDialog dialogType = iota
	warningDialog
	questionDialog
)

// messageDialogOptions describes a message dialog. The pressed button is
// reported by its label.
type messageDialogOptions struct {
	Type          dialogType
	Title         string
	Message       string
	Buttons       []string
	DefaultButton string
	CancelButton  string
}

// fileFilter limits a file dialog to files matching Pattern, such as
// "*.marasi", or several patterns joined by ";".
type fileFilter struct {
	DisplayName string
	Pattern     string
}

// openDialogOptions describes a dialog that picks one existing file.
type openDialogOptions struct {
	Title   string
	Filters []fileFilter
}

// saveDialogOptions describes a dialog that picks where to save a file.
type saveDialogOptions struct {
	DefaultDirectory string
	DefaultFilename  string
	Title            string
	Filters          []fileFilter
}

// nativeMessageDialog adapts message dialogs to what goos draws the way
// Marasi always has. Only macOS shows the custom buttons: Wails on Windows
// draws a warning as a lone OK, which answers neither Cancel nor the action,
// so a confirmation could never be confirmed. There, and on Linux, a
// two-button confirmation becomes a Yes/No question, and Yes answers as the
// action.
func nativeMessageDialog(goos string, show func(messageDialogOptions) (string, error)) func(messageDialogOptions) (string, error) {
	if goos == "darwin" {
		return show
	}
	return func(options messageDialogOptions) (string, error) {
		action, ok := confirmAction(options)
		if !ok {
			return show(options)
		}
		question := options
		question.Type = questionDialog
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
func confirmAction(options messageDialogOptions) (string, bool) {
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

// dialogButtons is the buttons a dialog shows. Wails answers only through a
// button's callback, so a dialog without buttons gets the ones the OS would
// draw: Yes and No for a question, OK otherwise.
func dialogButtons(options messageDialogOptions) []string {
	if len(options.Buttons) > 0 {
		return options.Buttons
	}
	if options.Type == questionDialog {
		return []string{"Yes", "No"}
	}
	return []string{"OK"}
}

// dialogAnswerEnv, when set in a -tags server build, names the button every
// message dialog answers instead of its cancel button, so the headless
// verification (verify-marasi) can go ahead where a researcher would.
const dialogAnswerEnv = "MARASI_DIALOG_ANSWER"

// serverDialogAnswer is a server build's answer to a dialog nobody sees:
// answer when it names one of its buttons, else dismissedButton.
func serverDialogAnswer(options messageDialogOptions, answer string) string {
	for _, button := range options.Buttons {
		if answer != "" && button == answer {
			return answer
		}
	}
	return dismissedButton(options)
}

// dismissedButton is the answer of a dialog nobody can see: its cancel
// button, or else its default.
func dismissedButton(options messageDialogOptions) string {
	if options.CancelButton != "" {
		return options.CancelButton
	}
	return options.DefaultButton
}

// fileDialogCancelled is the error Wails on Windows returns when the user
// cancels a file dialog. Other OSes return an empty path.
const fileDialogCancelled = "cancelled by user"

// fileDialogResult turns a file dialog's answer into a path, "" when the user
// cancelled, however the OS reports a cancel.
func fileDialogResult(path string, err error) (string, error) {
	if path == "" && err != nil && err.Error() == fileDialogCancelled {
		return "", nil
	}
	return path, err
}
