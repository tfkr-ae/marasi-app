// App wiring for the keybinding engine: the single dispatcher and palette
// registry used by every component, and the window keydown listener.
import { onMount } from "svelte";
import { writable } from "svelte/store";
import { buildCatalog } from "./catalog.js";
import { createDispatcher, OPEN_MENU } from "./dispatcher.js";
import { createPaletteRegistry } from "./palettes.js";
import { platformFromDesktopOS } from "./platform.js";

export const menuDispatcher = createDispatcher({
	catalog: buildCatalog(),
	platform: platformFromDesktopOS(undefined),
});

export const menuPalettes = createPaletteRegistry();

// The WebSocket modal's open tab (one of WEBSOCKET_TABS), or null while the
// modal is closed. The modal publishes it; its tab contexts read it as
// `state.websocketTab`.
export const websocketTab = writable(null);

// True while the keybinding settings modal records a shortcut. The
// dispatcher state carries it as `state.capturing`, and the gate then lets
// no menu action run.
export const keybindingCapture = writable(false);

// Opening the Marasi menu toggles the most specific mounted menu.
menuDispatcher.register(OPEN_MENU, () => menuPalettes.active()?.toggle());

// Listens on window in the capture phase. Install it after overlay
// isolation's own capture listener so modal toggle-close, Escape and focus
// handling keep precedence. Keys pressed in a CodeMirror editor are
// dispatched in the bubble phase instead, after the editor handled them.
export function installMenuShortcuts(getState) {
	const onKeydown = (event) => menuDispatcher.dispatch(event, getState());
	const afterEditor = (event) =>
		menuDispatcher.dispatch(event, getState(), { afterEditor: true });
	window.addEventListener("keydown", onKeydown, true);
	window.addEventListener("keydown", afterEditor);
	return () => {
		window.removeEventListener("keydown", onKeydown, true);
		window.removeEventListener("keydown", afterEditor);
	};
}

// Registers [{ actionId, handler }] now and returns a function that removes
// exactly these registrations.
export function registerMenuActions(actions) {
	const unregister = actions.map(({ actionId, handler }) =>
		menuDispatcher.register(actionId, handler),
	);
	return () => unregister.forEach((fn) => fn());
}

// Registers a page's menu action handlers, [{ actionId, handler }], for the
// lifetime of the calling component. Call it during component setup. All of
// a page's handlers stay registered; menu contexts decide which of them a
// key reaches (opening a drawer changes eligibility, not registrations).
export function useMenuActions(actions) {
	onMount(() => registerMenuActions(actions));
}
