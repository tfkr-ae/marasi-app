import assert from "node:assert/strict";
import test from "node:test";
import { pickTarget, sameBox } from "./targets.mjs";

const control = (overrides = {}) => ({
	index: 0, description: 'button "Save"', x: 100, y: 100, width: 60, height: 30,
	inViewport: true, hittable: true, coveredBy: null, disabled: false, ...overrides,
});

test("picks the only actionable match", () => {
	assert.deepEqual(pickTarget([control()]), { target: control() });
});

test("waits when nothing matches yet", () => {
	assert.equal(pickTarget([]).pending, "no element matches");
});

test("ignores a hidden menu copy of the same label", () => {
	const hidden = control({ index: 0, x: 0, y: 0, width: 0, height: 0, hittable: false });
	const painted = control({ index: 1 });
	assert.equal(pickTarget([hidden, painted]).target.index, 1);
});

test("waits while an overlay covers the match", () => {
	const covered = control({ hittable: false, coveredBy: "div.modal-backdrop" });
	assert.match(pickTarget([covered]).pending, /covered by div\.modal-backdrop/);
});

test("refuses to guess between two actionable matches", () => {
	const result = pickTarget([control({ index: 0 }), control({ index: 1, y: 200 })]);
	assert.match(result.pending, /2 matches receive a click/);
});

test("nth chooses among actionable matches on purpose", () => {
	const result = pickTarget([control({ index: 0 }), control({ index: 1, y: 200 })], { nth: 2 });
	assert.equal(result.target.index, 1);
});

test("waits for a disabled control to become enabled", () => {
	assert.match(pickTarget([control({ disabled: true })]).pending, /disabled/);
	assert.ok(pickTarget([control({ disabled: true })], { enabled: false }).target);
});

test("asks to scroll a unique match below the fold", () => {
	const below = control({ index: 3, y: 1200, inViewport: false, hittable: false });
	assert.deepEqual(pickTarget([below]), { scroll: 3 });
});

test("a moving box is not stable", () => {
	assert.ok(sameBox(control(), control({ x: 100.2 })));
	assert.ok(!sameBox(control(), control({ y: 140 })));
	assert.ok(!sameBox(null, control()));
});
