import { test } from "node:test";
import assert from "node:assert/strict";
import { createDrawingPage } from "./drawingPage.js";
import { FALLBACK_VIEWPORT } from "./drawingCards.js";
import { newCardElement } from "./cards.js";

function fakes({ rows = {} } = {}) {
  const calls = [];
  const tracked = [];
  const page = createDrawingPage({
    pairRows: {
      track(ids) {
        const entry = { ids, stopped: false };
        tracked.push(entry);
        return () => (entry.stopped = true);
      },
      rows: () => rows,
    },
    drawingCards: {
      lastCardId: () => null,
      noteAdded: (drawingId, elementId) => calls.push(["noteAdded", drawingId, elementId]),
    },
    setCanvasSize: (size) => calls.push(["canvas", size]),
    goto: async (path) => calls.push(["goto", path]),
    ledger: {
      goToNumber: async (n) => (calls.push(["number", n]), {}),
      selectPair: (id) => calls.push(["select", id]),
    },
    logbook: { open: (kind, id) => calls.push(["open", kind, id]) },
  });
  return { page, calls, tracked };
}

const pairCard = (id) => newCardElement({ kind: "pair", id }, { x: 0, y: 0 });

test("the pairs on a drawing are tracked once per set, and the last set stops when it changes", () => {
  const { page, tracked } = fakes();
  const finding = newCardElement({ kind: "finding", id: "f" }, { x: 0, y: 0 });
  page.trackPairs([pairCard("b"), pairCard("a"), finding]);
  page.trackPairs([pairCard("a"), pairCard("b")]);
  assert.equal(tracked.length, 1);
  assert.deepEqual(tracked[0].ids, ["a", "b"]);
  page.trackPairs([pairCard("a")]);
  assert.equal(tracked.length, 2);
  assert.equal(tracked[0].stopped, true);
  page.stopTracking();
  assert.equal(tracked[1].stopped, true);
});

// Excalidraw's api and module, enough for addCard.
function excalidraw(elements = []) {
  const scene = { elements };
  return {
    scene,
    api: {
      getSceneElementsIncludingDeleted: () => scene.elements,
      getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
      updateScene: ({ elements: next, captureUpdate }) => {
        scene.elements = next;
        scene.capture = captureUpdate;
      },
    },
    lib: { restoreElements: (els) => els, CaptureUpdateAction: { IMMEDIATELY: "now" } },
  };
}

test("a card goes in the middle of the canvas, in the undo history, and is remembered as the drawing's last", () => {
  const { page, calls } = fakes();
  const { api, lib, scene } = excalidraw();
  const element = page.addCard({ api, lib, drawingId: "d1", size: { width: 1000, height: 600 } }, { kind: "finding", id: "f" });
  assert.equal(scene.elements.length, 1);
  assert.equal(scene.capture, "now");
  assert.equal(element.x + element.width / 2, 500);
  assert.deepEqual(calls[0], ["canvas", { width: 1000, height: 600 }]);
  assert.deepEqual(calls[1], ["noteAdded", "d1", element.id]);
});

test("without the canvas's size, a card is placed in the fallback viewport", () => {
  const { page, calls } = fakes();
  const { api, lib } = excalidraw();
  const element = page.addCard({ api, lib, drawingId: "d1", size: null }, { kind: "finding", id: "f" });
  assert.equal(element.x + element.width / 2, FALLBACK_VIEWPORT.width / 2);
  assert.ok(!calls.some(([name]) => name === "canvas"));
});

test("a dropped pair card is centred on the drop and carries the pair's row", () => {
  const { page } = fakes();
  const { api, lib } = excalidraw();
  const row = { ID: "p", Number: 4 };
  const element = page.addCard({ api, lib, drawingId: "d1", size: { width: 1000, height: 600 } }, { kind: "pair", id: "p" }, row, { x: 300, y: 200 });
  assert.equal(element.x + element.width / 2, 300);
  assert.deepEqual(element.customData.last, row);
});

test("Open goes to the pair in the Ledger by its current number, else the one the card carries", async () => {
  const { page, calls } = fakes({ rows: { p: { Number: 9 } } });
  await page.openSource({ kind: "pair", id: "p" }, { Number: 4 });
  await page.openSource({ kind: "pair", id: "q" }, { Number: 4 });
  await page.openSource({ kind: "pair", id: "r" }, null);
  assert.deepEqual(calls, [["goto", "/ledger"], ["number", 9], ["goto", "/ledger"], ["number", 4], ["goto", "/ledger"]]);
});

test("Open goes to a finding or test case in the Logbook", async () => {
  const { page, calls } = fakes();
  await page.openSource({ kind: "testCase", id: "t" }, null);
  assert.deepEqual(calls, [["open", "testCase", "t"], ["goto", "/logbook"]]);
});

// The Ledger store as Open ↗ meets it: goToNumber selects a pair it has to
// read in, but only returns one the table already shows, for the caller to
// select (as the Ledger's own Open request does).
function fakeLedger(shown) {
  const ledger = {
    selected: null,
    async goToNumber(number) {
      const pair = shown.find((row) => row.Number === number);
      if (pair) return { pair };
      const outside = { ID: `outside-${number}`, Number: number };
      ledger.selected = outside.ID;
      return { pair: outside };
    },
    selectPair(id) {
      ledger.selected = String(id);
    },
  };
  return ledger;
}

test("Open on a pair the Ledger already shows selects it, so its drawer opens", async () => {
  const ledger = fakeLedger([{ ID: "p", Number: 4 }]);
  const page = createDrawingPage({
    pairRows: { track: () => () => {}, rows: () => ({}) },
    drawingCards: {},
    setCanvasSize: () => {},
    goto: async () => {},
    ledger,
    logbook: {},
  });
  await page.openSource({ kind: "pair", id: "p" }, { ID: "p", Number: 4 });
  assert.equal(ledger.selected, "p");
});

test("Open on a pair the Ledger has to read in leaves it selected", async () => {
  const ledger = fakeLedger([]);
  const page = createDrawingPage({
    pairRows: { track: () => () => {}, rows: () => ({ q: { ID: "q", Number: 7 } }) },
    drawingCards: {},
    setCanvasSize: () => {},
    goto: async () => {},
    ledger,
    logbook: {},
  });
  await page.openSource({ kind: "pair", id: "q" }, null);
  assert.equal(ledger.selected, "outside-7");
});
