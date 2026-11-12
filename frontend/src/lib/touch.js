// Touch fixes for the iOS app, installed by the root layout only there, so
// the desktop's mouse and keyboard handling is unchanged.
//
// - A long press opens the menu a right-click opens: iOS sends no
//   `contextmenu` for one, so the Ledger, Armory and Launchpad menus had no
//   way in. It skips fields and editors, whose long press selects text.
// - A modal opening doesn't raise the keyboard: Skeleton's focus trap
//   focuses its first field, which on a phone covers half the modal.
// - Two fingers swiped down open the Marasi menu, which has no key to
//   reach it without a keyboard. While two fingers are down the page
//   doesn't scroll, so the swipe opens the menu and moves nothing.

export const LONG_PRESS_MS = 500;
/** How far, in px, a finger may drift before the press counts as a scroll. */
export const LONG_PRESS_SLOP = 10;
/** How long after the menu opens the release's click is swallowed. */
const SWALLOW_MS = 800;

const TYPING = "input, textarea, select, [contenteditable], .cm-editor";

const menuEvent = (x, y) =>
	new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });

/**
 * Sends a `contextmenu` at the finger to the pressed element after a still
 * press of LONG_PRESS_MS. Returns a function that removes the listeners.
 * `root` is the window; tests pass an EventTarget and fake timers.
 */
export function installLongPress(
	root,
	{ setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, makeEvent = menuEvent } = {},
) {
	let timer = null;
	let start = null;
	let swallowUntil = 0;

	function cancel() {
		if (timer !== null) clearTimer(timer);
		timer = null;
		start = null;
	}
	function onStart(event) {
		cancel();
		if (event.touches.length !== 1 || event.target?.closest?.(TYPING)) return;
		const { clientX, clientY } = event.touches[0];
		const target = event.target;
		start = { x: clientX, y: clientY };
		timer = setTimer(() => {
			timer = null;
			start = null;
			swallowUntil = now() + SWALLOW_MS;
			target.dispatchEvent(makeEvent(clientX, clientY));
		}, LONG_PRESS_MS);
	}
	function onMove(event) {
		if (!start) return;
		const touch = event.touches[0];
		if (!touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > LONG_PRESS_SLOP) cancel();
	}
	// Lifting the finger would otherwise click the row under the new menu.
	function onClick(event) {
		if (now() >= swallowUntil) return;
		swallowUntil = 0;
		event.preventDefault();
		event.stopPropagation();
	}

	const passive = { passive: true };
	root.addEventListener("touchstart", onStart, passive);
	root.addEventListener("touchmove", onMove, passive);
	root.addEventListener("touchend", cancel, passive);
	root.addEventListener("touchcancel", cancel, passive);
	root.addEventListener("click", onClick, true);
	return () => {
		cancel();
		root.removeEventListener("touchstart", onStart, passive);
		root.removeEventListener("touchmove", onMove, passive);
		root.removeEventListener("touchend", cancel, passive);
		root.removeEventListener("touchcancel", cancel, passive);
		root.removeEventListener("click", onClick, true);
	};
}

/**
 * Blurs the field a modal's focus trap focused, each time a modal opens.
 * `modals` is Skeleton's modal store; `doc` the document. Returns the
 * unsubscribe. `defer` runs after the modal mounts.
 */
export function keepKeyboardDown(modals, doc, defer = (fn) => setTimeout(fn, 50)) {
	let open = false;
	return modals.subscribe((stack) => {
		const opened = stack.length > 0 && !open;
		open = stack.length > 0;
		if (!opened) return;
		defer(() => {
			const field = doc.activeElement;
			if (field?.matches?.(TYPING)) field.blur();
		});
	});
}

/** How far, in px, two fingers travel down before the swipe counts. */
export const SWIPE_DOWN_PX = 80;

/**
 * Calls `onSwipe` once when two fingers move down together by SWIPE_DOWN_PX,
 * mostly straight down. Returns a function that removes the listeners.
 */
export function installTwoFingerSwipeDown(root, onSwipe) {
	let start = null;
	// From a second finger landing until every finger lifts, the page
	// doesn't scroll, after the menu opens too.
	let held = false;
	const centre = (touches) => ({
		x: (touches[0].clientX + touches[1].clientX) / 2,
		y: (touches[0].clientY + touches[1].clientY) / 2,
	});
	function onStart(event) {
		held = held || event.touches.length >= 2;
		start = event.touches.length === 2 ? centre(event.touches) : null;
	}
	function onMove(event) {
		if (held && event.cancelable) event.preventDefault();
		if (!start) return;
		if (event.touches.length !== 2) {
			start = null;
			return;
		}
		const now = centre(event.touches);
		const down = now.y - start.y;
		const across = Math.abs(now.x - start.x);
		if (down >= SWIPE_DOWN_PX && across <= down / 2) {
			start = null;
			onSwipe();
		}
	}
	function end(event) {
		start = null;
		if (event.touches.length === 0) held = false;
	}

	const passive = { passive: true };
	// Not passive: it cancels the scroll.
	const active = { passive: false };
	root.addEventListener("touchstart", onStart, passive);
	root.addEventListener("touchmove", onMove, active);
	root.addEventListener("touchend", end, passive);
	root.addEventListener("touchcancel", end, passive);
	return () => {
		root.removeEventListener("touchstart", onStart, passive);
		root.removeEventListener("touchmove", onMove, active);
		root.removeEventListener("touchend", end, passive);
		root.removeEventListener("touchcancel", end, passive);
	};
}

/**
 * Swallows the next click on `root` within `ms`: a tap that closes a menu
 * shouldn't also tap what was under it (a Ledger row, opening its drawer).
 * A mouse press closes menus the same way but its click is the desktop's
 * to keep, so callers use it for touch only.
 */
export function swallowNextClick(root, ms = 700, { setTimer = setTimeout } = {}) {
	// `done` as well as removing the listener: Node 20's EventTarget keeps a
	// capture listener removed by a plain `true` (CI runs it), and a click
	// must never be swallowed twice.
	let done = false;
	const swallow = (event) => {
		if (done) return;
		event.preventDefault();
		event.stopPropagation();
		stop();
	};
	const stop = () => {
		done = true;
		root.removeEventListener("click", swallow, true);
	};
	root.addEventListener("click", swallow, true);
	setTimer(stop, ms);
}
