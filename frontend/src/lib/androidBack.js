// Android's Back (MainActivity.handleBack asks window.marasiBack): it
// closes the open sheet first, as Escape does; then goes back a page; then,
// from Home with nowhere to go back to, it lets the app go to the
// background. Returns whether the app handled it.
//
// - `closeTop()` closes the top modal, drawer or menu (closeTopOverlay),
//   returning whether there was one.
// - `historyIndex` is SvelteKit's place in the session history (0 at the
//   first page the app showed).
// - `path` is the current page; `back()` and `home()` go back a page or to
//   Home.
export function androidBack({ closeTop, historyIndex, path, back, home }) {
	if (closeTop()) return true;
	if (historyIndex > 0) {
		back();
		return true;
	}
	if (path !== "/") {
		home();
		return true;
	}
	return false;
}
