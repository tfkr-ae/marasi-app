// Whether this is the iOS app, asked of Go once when the app loads (the
// layout registers the Connections modal, which imports this): false until
// Go answers, and when the question fails. On iOS the root element also gets
// the `ios` class, for touch-only CSS in app.css.
//
// The iOS app runs no Marasi CLI, no Chrome and no app updater of its own,
// so what needs them is hidden there; nothing changes on the desktop.
import { writable } from "svelte/store";
import { isIOS } from "./runtime.js";

/** Resolves to whether this is the iOS app; false when Go can't say. */
export const iosCheck = isIOS().catch(() => false);

const store = writable(false);
iosCheck.then((ios) => {
	store.set(ios);
	if (ios && typeof document !== "undefined") document.documentElement.classList.add("ios");
});

export const ios = { subscribe: store.subscribe };

/** ⌘K actions the iOS app leaves out: they start Chrome or update the app. */
export const IOS_HIDDEN_ACTIONS = new Set(["global.start-chrome", "global.check-for-updates"]);

/** Settings sections the iOS app leaves out: Chrome, and the app and CLI updaters. */
export const IOS_HIDDEN_SECTIONS = new Set(["browser", "updates"]);
