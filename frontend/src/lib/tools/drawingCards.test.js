import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createToolDocuments, drawingKind } from "./toolDocuments.js";
import { createDrawingCards } from "./drawingCards.js";
import { CARD_GAP, CARD_HEIGHT, CARD_WIDTH, cardSource } from "./cards.js";

function setup() {
  const documents = createToolDocuments({ drawing: drawingKind });
  documents.useProject("/p/one.marasi");
  const drawings = documents.kind("drawing");
  return { drawings, cards: createDrawingCards(drawings, { viewport: () => ({ width: 1000, height: 600 }) }) };
}

const row = { ID: "p-1", Number: 3, Method: "POST", Path: "/api/login", Host: "example.com" };

test("adding a pair puts its card on the last-opened drawing, with the pair's row", () => {
  const { drawings, cards } = setup();
  drawings.create();
  const target = drawings.create();
  const { drawing, element } = cards.add({ kind: "pair", id: "p-1" }, { last: row });
  assert.equal(drawing.id, target.id);
  const stored = get(drawings).items.find((d) => d.id === target.id);
  assert.deepEqual(stored.scene.elements.map(cardSource), [{ kind: "pair", id: "p-1" }]);
  assert.equal(stored.scene.elements[0].id, element.id);
  assert.deepEqual(stored.scene.elements[0].customData.last, row);
});

test("a drawing that was never shown gets the card in the middle of its view", () => {
  const { drawings, cards } = setup();
  const { element } = cards.add({ kind: "finding", id: "f1" });
  assert.deepEqual([element.x, element.y], [500 - CARD_WIDTH / 2, 300 - CARD_HEIGHT / 2]);
  assert.equal(drawingKind.isEmpty(drawings.current()), false);
});

test("the view follows the drawing's scroll and zoom", () => {
  const { drawings, cards } = setup();
  const { id } = drawings.current();
  drawings.change(id, { scene: { elements: [], appState: { scrollX: -2000, scrollY: 100, zoom: { value: 2 } } } });
  const { element } = cards.add({ kind: "finding", id: "f1" });
  // 1000×600 at zoom 2 shows 500×300 of the scene, from (2000, -100).
  assert.deepEqual([element.x, element.y], [2250 - CARD_WIDTH / 2, 50 - CARD_HEIGHT / 2]);
});

test("the next card goes under the one added last, and the scene's other elements stay", () => {
  const { drawings, cards } = setup();
  const { id } = drawings.current();
  const shape = { id: "r1", type: "rectangle", x: -900, y: -900, width: 10, height: 10, isDeleted: false };
  drawings.change(id, { scene: { elements: [shape], appState: {} } });
  const first = cards.add({ kind: "finding", id: "f1" }).element;
  const second = cards.add({ kind: "testCase", id: "t1" }).element;
  assert.deepEqual([second.x, second.y], [first.x, first.y + first.height + CARD_GAP]);
  assert.deepEqual(drawings.current().scene.elements.map((e) => e.id), ["r1", first.id, second.id]);
  assert.equal(cards.lastCardId(id), second.id);
});

test("the last card added is remembered per drawing", () => {
  const { drawings, cards } = setup();
  const one = drawings.current();
  cards.noteAdded(one.id, "card-x");
  const two = drawings.create();
  assert.equal(cards.lastCardId(two.id), null);
  assert.equal(cards.lastCardId(one.id), "card-x");
});
