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

// The global menu's entries ({ actionId, icon, name, ... }, with live names
// such as the intercept toggle), published by GlobalMenu.svelte. Every
// Marasi menu lists them in its Marasi section, after the page's own.
export const globalMenuEntries = writable([]);

// The WebSocket modal's open tab (one of WEBSOCKET_TABS), or null while the
// modal is closed. The modal publishes it; its tab contexts read it as
// `state.websocketTab`.
export const websocketTab = writable(null);

// Whether the Armory page's request drawer is open. The page publishes it;
// the armory contexts read it as `state.armoryDrawer` ({ open }).
export const armoryDrawer = writable({ open: false });

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
	installedState = getState;
	const stop = listenForMenuShortcuts(window, getState);
	return () => {
		if (installedState === getState) installedState = null;
		stop();
	};
}

// The state getter installMenuShortcuts was given, for frames.
let installedState = null;

// Sends the keydowns of `target` (a window) through the dispatcher in the two
// passes installMenuShortcuts describes. Returns the remover.
export function listenForMenuShortcuts(target, getState) {
	// An open <dialog> is the Marasi menu (gate.js); a shortcut pressed in it
	// closes it, then runs.
	const closeMenu = () => globalThis.document?.querySelector("dialog[open]")?.close();
	const onKeydown = (event) =>
		menuDispatcher.dispatch(event, getState(), { closeMenu });
	const afterEditor = (event) =>
		menuDispatcher.dispatch(event, getState(), { afterEditor: true, closeMenu });
	target.addEventListener("keydown", onKeydown, true);
	target.addEventListener("keydown", afterEditor);
	return () => {
		target.removeEventListener("keydown", onKeydown, true);
		target.removeEventListener("keydown", afterEditor);
	};
}

// Sends a same-origin frame's keydowns (CyberChef's window) through the
// dispatcher as the app window's own, so ⌘K and the page's actions work with
// focus inside it. Keys no action takes, such as CyberChef's Ctrl+Alt ones,
// stay with the frame. Returns the remover.
export function forwardMenuShortcuts(frameWindow) {
	const getState = installedState;
	if (!getState) return () => {};
	return listenForMenuShortcuts(frameWindow, getState);
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
