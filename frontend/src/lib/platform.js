// Which platform the app runs on, asked of Go once when the app loads (the
// layout registers the Connections modal, which imports this): "desktop"
// until Go answers, and when the question fails.
//
// Two questions, kept apart:
// - `mobile`: a phone or tablet app (iOS, Android). It runs no Marasi CLI,
//   no Chrome and no app updater of its own, pairs with a remote service,
//   and takes the touch layout. The root element gets the `mobile` class,
//   for the touch-only CSS.
// - `platform`: which one, for the few things that differ between them
//   (the share sheet, the QR scanner). The root element gets its name as a
//   class too (`ios`, `android`).
// Nothing changes on the desktop.
import { derived, writable } from "svelte/store";
import { platformOS } from "./runtime.js";

const MOBILE_OS = new Set(["ios", "android"]);

/** Maps Go's OS (runtime.GOOS) to "ios", "android" or "desktop". */
export function platformOf(os) {
	return MOBILE_OS.has(os) ? os : "desktop";
}

/** Resolves to "ios", "android" or "desktop"; "desktop" when Go can't say. */
export const platformCheck = platformOS()
	.then(platformOf)
	.catch(() => "desktop");

/** Resolves to whether this is the iOS or Android app. */
export const mobileCheck = platformCheck.then((name) => name !== "desktop");

const store = writable("desktop");
platformCheck.then((name) => {
	store.set(name);
	if (name !== "desktop" && typeof document !== "undefined") {
		document.documentElement.classList.add("mobile", name);
	}
});

/** "ios", "android" or "desktop". */
export const platform = { subscribe: store.subscribe };

/** Whether this is the iOS or Android app. */
export const mobile = derived(store, (name) => name !== "desktop");

/** ⌘K actions the mobile app leaves out: they start Chrome or update the app. */
export const MOBILE_HIDDEN_ACTIONS = new Set(["global.start-chrome", "global.check-for-updates"]);

/** Settings sections the mobile app leaves out: Chrome, and the app and CLI updaters. */
export const MOBILE_HIDDEN_SECTIONS = new Set(["browser", "updates"]);
