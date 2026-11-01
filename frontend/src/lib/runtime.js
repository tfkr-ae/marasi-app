// The app's one door to the Wails runtime for everything that isn't a
// binding: events, the window title and opening links in the browser. Other
// files import from here, never from the runtime itself. The root layout
// imports it, which also makes binding errors read as their message.
//
// A subscriber's callback receives the event's payload. `on` and `once` return
// a function that removes that one listener, and `off` removes every listener
// for a name.
import * as wails from "@wailsio/runtime";

// createRuntime builds the calls over a runtime that `getRuntime` returns when
// a call is made. That is the `@wailsio/runtime` module; tests pass a fake.
// Wails hands a listener a `{name, data}` event, and `data` is the payload Go
// emitted: the value itself, or null when it sent none.
export function createRuntime(getRuntime) {
	const payload = (callback) => (event) => callback(event.data);
	return {
		on: (name, callback) => getRuntime().Events.On(name, payload(callback)),
		once: (name, callback) => getRuntime().Events.Once(name, payload(callback)),
		off: (name) => getRuntime().Events.Off(name),
		emit: (name, data) => getRuntime().Events.Emit(name, data),
		setWindowTitle: (title) => getRuntime().Window.SetTitle(title),
		openURL: (url) => getRuntime().Browser.OpenURL(url),
	};
}

export const { on, once, off, emit, setWindowTitle, openURL } = createRuntime(() => wails);

// readAsMessage makes errors of ErrorClass read as their message alone. A
// failed binding call rejects with a RuntimeError whose message is the Go
// error's text, and the UI shows errors with String() and template strings,
// which would put "RuntimeError: " in front of it.
export function readAsMessage(ErrorClass) {
	ErrorClass.prototype.toString = function () {
		return this.message;
	};
}

readAsMessage(wails.Call.RuntimeError);
