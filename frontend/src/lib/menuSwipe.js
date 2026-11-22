// The two-finger swipe down that opens the Marasi menu on a phone or
// tablet (lib/touch.js), on a window: the app's, and each same-origin
// frame's (CyberChef), whose touches never reach the app's window.
import { get } from "svelte/store";
import { installTwoFingerSwipeDown } from "./touch.js";
import { menuPalettes } from "./keybindings/app.js";

/**
 * Opens the active Marasi menu on a two-finger swipe down on `root`, never
 * over another dialog or a modal (`modals` is Skeleton's modal store, or
 * null where there is none).
 * Returns the function that removes it.
 */
export function installMenuSwipe(root, modals, doc = document) {
	return installTwoFingerSwipeDown(root, () => {
		if (doc.querySelector("dialog[open]") || (modals && get(modals).length > 0)) return;
		menuPalettes.active()?.toggle();
	});
}
