import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMORY_DOCK, DOCK, DOCK_SNAP, DOCK_STRIP, LEDGER_DOCK, dragWidth, settleDrag, toggleDock } from "./dock.js";

test("the Launchpad dock starts 400px wide", () => {
  assert.equal(DOCK.default, 400);
});

test("dragging follows the pointer but never past 640px", () => {
  assert.equal(dragWidth(400, 100), 500);
  assert.equal(dragWidth(400, 900), 640);
  assert.equal(dragWidth(400, -900), 0);
});

test("the dock collapses only about as narrow as the strip", () => {
  assert.ok(DOCK_SNAP - DOCK_STRIP <= 24);
});

test("releasing below 64px snaps the dock to the collapsed strip", () => {
  assert.deepEqual(settleDrag(63, 400), { collapsed: true, width: 400 });
});

test("releasing at or above 64px keeps it open at that width, with no minimum", () => {
  assert.deepEqual(settleDrag(64, 400), { collapsed: false, width: 64 });
  assert.deepEqual(settleDrag(120, 400), { collapsed: false, width: 120 });
  assert.deepEqual(settleDrag(500, 400), { collapsed: false, width: 500 });
});

test("the Ledger dock starts 320px wide and sizes up to 560px", () => {
  assert.equal(LEDGER_DOCK.default, 320);
  assert.equal(dragWidth(320, 900, LEDGER_DOCK), 560);
  assert.deepEqual(settleDrag(120, 320, LEDGER_DOCK), { collapsed: false, width: 120 });
  assert.deepEqual(settleDrag(63, 320, LEDGER_DOCK), { collapsed: true, width: 320 });
});

test("the Armory dock starts 300px wide and sizes up to 520px", () => {
  assert.equal(ARMORY_DOCK.default, 300);
  assert.equal(dragWidth(300, 900, ARMORY_DOCK), 520);
  assert.deepEqual(settleDrag(150, 300, ARMORY_DOCK), { collapsed: false, width: 150 });
  assert.deepEqual(settleDrag(40, 300, ARMORY_DOCK), { collapsed: true, width: 300 });
});

test("toggling collapses an open dock and expands a collapsed one at its width", () => {
  assert.deepEqual(toggleDock({ width: 300, collapsed: false }), { width: 300, collapsed: true });
  assert.deepEqual(toggleDock({ width: 300, collapsed: true }), { width: 300, collapsed: false });
});
