// The iOS app's long press and modal keyboard fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writable } from "svelte/store";
import { installLongPress, installTwoFingerSwipeDown, keepKeyboardDown, LONG_PRESS_MS, swallowNextClick, SWIPE_DOWN_PX } from "./touch.js";

// Timers that run when the test says, and a clock it moves.
function fakeTime() {
	const timers = new Map();
	let next = 0;
	const time = {
		now: 0,
		setTimer: (fn, ms) => (timers.set(++next, { fn, at: time.now + ms }), next),
		clearTimer: (id) => timers.delete(id),
		advance(ms) {
			time.now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at <= time.now) {
					timers.delete(id);
					timer.fn();
				}
			}
		},
	};
	return time;
}

// An element that records the events sent to it; `typing` makes it a field.
function element({ typing = false } = {}) {
	const got = [];
	return { got, closest: () => (typing ? {} : null), dispatchEvent: (event) => got.push(event) };
}

function touchEvent(type, target, x = 10, y = 10, touches = 1) {
	const event = new Event(type);
	Object.defineProperty(event, "target", { value: target });
	event.touches = Array.from({ length: touches }, () => ({ clientX: x, clientY: y }));
	return event;
}

function setup() {
	const root = new EventTarget();
	const time = fakeTime();
	const remove = installLongPress(root, {
		setTimer: time.setTimer,
		clearTimer: time.clearTimer,
		now: () => time.now,
		makeEvent: (x, y) => ({ type: "contextmenu", x, y }),
	});
	return { root, time, remove };
}

test("a still press sends a contextmenu at the finger to the pressed element", () => {
	const { root, time } = setup();
	const row = element();
	root.dispatchEvent(touchEvent("touchstart", row, 40, 120));
	time.advance(LONG_PRESS_MS - 1);
	assert.deepEqual(row.got, []);
	time.advance(1);
	assert.deepEqual(row.got, [{ type: "contextmenu", x: 40, y: 120 }]);
});

test("lifting the finger or scrolling before then sends nothing", () => {
	const { root, time } = setup();
	const row = element();
	root.dispatchEvent(touchEvent("touchstart", row));
	root.dispatchEvent(touchEvent("touchend", row, 10, 10, 0));
	root.dispatchEvent(touchEvent("touchstart", row, 10, 10));
	root.dispatchEvent(touchEvent("touchmove", row, 10, 40));
	time.advance(LONG_PRESS_MS * 2);
	assert.deepEqual(row.got, []);
});

test("a small drift still counts as a press", () => {
	const { root, time } = setup();
	const row = element();
	root.dispatchEvent(touchEvent("touchstart", row, 10, 10));
	root.dispatchEvent(touchEvent("touchmove", row, 14, 16));
	time.advance(LONG_PRESS_MS);
	assert.equal(row.got.length, 1);
});

test("fields and two-finger presses keep their own long press", () => {
	const { root, time } = setup();
	const field = element({ typing: true });
	const row = element();
	root.dispatchEvent(touchEvent("touchstart", field));
	root.dispatchEvent(touchEvent("touchstart", row, 10, 10, 2));
	time.advance(LONG_PRESS_MS);
	assert.deepEqual(field.got, []);
	assert.deepEqual(row.got, []);
});

test("the click from lifting after the menu opens is swallowed, later ones aren't", () => {
	const { root, time } = setup();
	const row = element();
	root.dispatchEvent(touchEvent("touchstart", row));
	time.advance(LONG_PRESS_MS);
	const release = new Event("click", { cancelable: true });
	root.dispatchEvent(release);
	assert.equal(release.defaultPrevented, true);
	const next = new Event("click", { cancelable: true });
	root.dispatchEvent(next);
	assert.equal(next.defaultPrevented, false);
});

test("removing it stops the press", () => {
	const { root, time, remove } = setup();
	const row = element();
	root.dispatchEvent(touchEvent("touchstart", row));
	remove();
	time.advance(LONG_PRESS_MS);
	assert.deepEqual(row.got, []);
});

test("a modal opening blurs the field its focus trap focused, once per opening", () => {
	const modals = writable([]);
	let blurs = 0;
	const field = { matches: () => true, blur: () => blurs++ };
	const doc = { activeElement: field };
	const stop = keepKeyboardDown(modals, doc, (fn) => fn());
	modals.set([{ component: "a" }]);
	modals.set([{ component: "a" }, { component: "b" }]);
	assert.equal(blurs, 1);
	modals.set([]);
	modals.set([{ component: "a" }]);
	assert.equal(blurs, 2);
	stop();
});

test("a modal that focused a button leaves it focused", () => {
	const modals = writable([]);
	let blurs = 0;
	const doc = { activeElement: { matches: () => false, blur: () => blurs++ } };
	keepKeyboardDown(modals, doc, (fn) => fn());
	modals.set([{ component: "a" }]);
	assert.equal(blurs, 0);
});

// A touch event with fingers at these [x, y] points.
function fingers(type, points) {
	const event = new Event(type, { cancelable: true });
	event.touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
	return event;
}

function swipeSetup() {
	const root = new EventTarget();
	let swipes = 0;
	const remove = installTwoFingerSwipeDown(root, () => swipes++);
	return { root, swipes: () => swipes, remove };
}

test("two fingers moving down together open the menu once", () => {
	const { root, swipes } = swipeSetup();
	root.dispatchEvent(fingers("touchstart", [[100, 100], [160, 100]]));
	root.dispatchEvent(fingers("touchmove", [[100, 140], [160, 140]]));
	assert.equal(swipes(), 0);
	root.dispatchEvent(fingers("touchmove", [[105, 100 + SWIPE_DOWN_PX], [165, 100 + SWIPE_DOWN_PX]]));
	root.dispatchEvent(fingers("touchmove", [[105, 300], [165, 300]]));
	assert.equal(swipes(), 1);
});

test("one finger, a swipe up, or a sideways swipe opens nothing", () => {
	const { root, swipes } = swipeSetup();
	root.dispatchEvent(fingers("touchstart", [[100, 100]]));
	root.dispatchEvent(fingers("touchmove", [[100, 300]]));
	root.dispatchEvent(fingers("touchstart", [[100, 300], [160, 300]]));
	root.dispatchEvent(fingers("touchmove", [[100, 100], [160, 100]]));
	root.dispatchEvent(fingers("touchstart", [[100, 100], [160, 100]]));
	root.dispatchEvent(fingers("touchmove", [[300, 200], [360, 200]]));
	assert.equal(swipes(), 0);
});

test("lifting a finger mid-swipe ends it", () => {
	const { root, swipes } = swipeSetup();
	root.dispatchEvent(fingers("touchstart", [[100, 100], [160, 100]]));
	root.dispatchEvent(fingers("touchmove", [[100, 100]]));
	root.dispatchEvent(fingers("touchmove", [[100, 300], [160, 300]]));
	assert.equal(swipes(), 0);
});

test("the page doesn't scroll from a second finger landing until every finger lifts", () => {
	const { root } = swipeSetup();
	const one = fingers("touchmove", [[100, 120]]);
	root.dispatchEvent(fingers("touchstart", [[100, 100]]));
	root.dispatchEvent(one);
	assert.equal(one.defaultPrevented, false);

	root.dispatchEvent(fingers("touchstart", [[100, 100], [160, 100]]));
	const moves = [
		fingers("touchmove", [[100, 140], [160, 140]]),
		fingers("touchmove", [[100, 100 + SWIPE_DOWN_PX], [160, 100 + SWIPE_DOWN_PX]]),
		fingers("touchmove", [[100, 300], [160, 300]]),
	];
	moves.forEach((move) => root.dispatchEvent(move));
	assert.ok(moves.every((move) => move.defaultPrevented));
	root.dispatchEvent(fingers("touchend", [[100, 300]]));
	const left = fingers("touchmove", [[100, 320]]);
	root.dispatchEvent(left);
	assert.equal(left.defaultPrevented, true);

	root.dispatchEvent(fingers("touchend", []));
	root.dispatchEvent(fingers("touchstart", [[100, 100]]));
	const after = fingers("touchmove", [[100, 140]]);
	root.dispatchEvent(after);
	assert.equal(after.defaultPrevented, false);
});

test("the tap that closes a menu doesn't reach what was under it, once", () => {
	const root = new EventTarget();
	let expire = null;
	swallowNextClick(root, 700, { setTimer: (fn) => (expire = fn) });
	const tap = new Event("click", { cancelable: true });
	root.dispatchEvent(tap);
	assert.equal(tap.defaultPrevented, true);
	const next = new Event("click", { cancelable: true });
	root.dispatchEvent(next);
	assert.equal(next.defaultPrevented, false);
	expire();
});

test("a click after the wait goes through", () => {
	const root = new EventTarget();
	let expire = null;
	swallowNextClick(root, 700, { setTimer: (fn) => (expire = fn) });
	expire();
	const late = new Event("click", { cancelable: true });
	root.dispatchEvent(late);
	assert.equal(late.defaultPrevented, false);
});
