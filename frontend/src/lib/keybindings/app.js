// App wiring for the keybinding engine: the single dispatcher and palette
// registry used by every component, and the window keydown listener.
import { onMount } from "svelte";
import { buildCatalog } from "./catalog.js";
import { createDispatcher, OPEN_MENU } from "./dispatcher.js";
import { createPaletteRegistry } from "./palettes.js";
import { platformFromDesktopOS } from "./platform.js";

export const menuDispatcher = createDispatcher({
	catalog: buildCatalog(),
	platform: platformFromDesktopOS(undefined),
});

export const menuPalettes = createPaletteRegistry();

// Opening the Marasi menu toggles the most specific mounted menu.
menuDispatcher.register(OPEN_MENU, () => menuPalettes.active()?.toggle());

// Listens on window in the capture phase. Install it after overlay
// isolation's own capture listener so modal toggle-close, Escape and focus
// handling keep precedence. A dispatched action stops propagation, so the
// remaining per-page hotkeys-js bindings never see the same event.
export function installMenuShortcuts(getState) {
	const onKeydown = (event) => menuDispatcher.dispatch(event, getState());
	window.addEventListener("keydown", onKeydown, true);
	return () => window.removeEventListener("keydown", onKeydown, true);
}

// Registers a page's menu action handlers, [{ actionId, handler }], for the
// lifetime of the calling component. Call it during component setup. All of
// a page's handlers stay registered; menu contexts decide which of them a
// key reaches (opening a drawer changes eligibility, not registrations).
export function useMenuActions(actions) {
	onMount(() => {
		const unregister = actions.map(({ actionId, handler }) =>
			menuDispatcher.register(actionId, handler),
		);
		return () => unregister.forEach((fn) => fn());
	});
}
