// The app's one door to the Wails runtime for everything that isn't a
// binding: events, the window title and opening links in the browser. Other
// files import from here, never from the runtime itself.
//
// A subscriber's callback receives the event's payload. `on` and `once` return
// a function that removes that one listener, and `off` removes every listener
// for a name.

// createRuntime builds the calls over a runtime that `getRuntime` returns when
// a call is made. That is Wails v2's `window.runtime`, which Wails injects at
// load; tests pass a fake.
export function createRuntime(getRuntime) {
	const subscribe = (name, callback, max) =>
		getRuntime().EventsOnMultiple(name, (payload) => callback(payload), max);
	return {
		on: (name, callback) => subscribe(name, callback, -1),
		once: (name, callback) => subscribe(name, callback, 1),
		off: (name) => getRuntime().EventsOff(name),
		emit: (name, data) => getRuntime().EventsEmit(name, data),
		setWindowTitle: (title) => getRuntime().WindowSetTitle(title),
		openURL: (url) => getRuntime().BrowserOpenURL(url),
	};
}

export const { on, once, off, emit, setWindowTitle, openURL } = createRuntime(() => window.runtime);
