import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactScene, suggestedCardIds, CARD_GAP, CARD_HEIGHT, CARD_WIDTH, cardSource, fitCard, newCardElement, placeCard, sourceOfLink } from "./cards.js";

const pairRow = { ID: "p-1", Number: 7, Method: "GET", Path: "/login" };

test("a card is an embeddable linking to its source, whose whole area takes arrows", () => {
  const card = newCardElement({ kind: "finding", id: "f-9" }, { x: 10, y: 20 });
  assert.equal(card.type, "embeddable");
  assert.equal(card.link, "marasi://finding/f-9");
  assert.deepEqual(card.customData.source, { kind: "finding", id: "f-9" });
  assert.equal(card.fillStyle, "solid");
  assert.notEqual(card.backgroundColor, "transparent");
  assert.equal(card.roundness, null);
  assert.deepEqual([card.x, card.y], [10, 20]);
  assert.ok(card.width > 0 && card.height > 0);
  assert.equal(card.isDeleted, false);
  assert.ok(card.id);
});

test("a pair card carries the pair's row, so it renders outside the loaded page", () => {
  const card = newCardElement({ kind: "pair", id: "p-1" }, { x: 0, y: 0 }, { last: pairRow });
  assert.deepEqual(card.customData.last, pairRow);
});

test("two cards get different ids", () => {
  const a = newCardElement({ kind: "testCase", id: "t-1" }, { x: 0, y: 0 });
  const b = newCardElement({ kind: "testCase", id: "t-1" }, { x: 0, y: 0 });
  assert.notEqual(a.id, b.id);
});

test("a card's source comes back from its element; other elements have none", () => {
  const card = newCardElement({ kind: "testCase", id: "t-1" }, { x: 0, y: 0 });
  assert.deepEqual(cardSource(card), { kind: "testCase", id: "t-1" });
  assert.equal(cardSource({ type: "rectangle", customData: { source: { kind: "pair", id: "x" } } }), null);
  assert.equal(cardSource({ type: "embeddable", link: "https://example.com" }), null);
  assert.equal(cardSource({ ...card, isDeleted: true }), null);
});

test("only marasi links name a source", () => {
  assert.deepEqual(sourceOfLink("marasi://pair/01937f5d-35"), { kind: "pair", id: "01937f5d-35" });
  assert.deepEqual(sourceOfLink("marasi://testCase/12"), { kind: "testCase", id: "12" });
  assert.equal(sourceOfLink("marasi://launchpad/1"), null);
  assert.equal(sourceOfLink("https://example.com/drawing"), null);
  assert.equal(sourceOfLink(undefined), null);
});

const card = (id, x, y, height = 120) => ({ ...newCardElement({ kind: "finding", id }, { x, y }, { height }), id });
const view = { x: 0, y: 0, width: 1200, height: 800 };
const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("with nothing added yet, a card goes in the middle of the view", () => {
  const at = placeCard({ elements: [], view });
  assert.deepEqual(at, { x: 600 - CARD_WIDTH / 2, y: 400 - CARD_HEIGHT / 2 });
});

test("the next card goes under the last card added, at the height it has now", () => {
  const last = card("a", 100, 100, 180);
  const at = placeCard({ elements: [last], lastId: "a", view });
  assert.deepEqual(at, { x: 100, y: 100 + 180 + CARD_GAP });
});

test("once the spot under the last card is out of view, the card goes in the middle", () => {
  const last = card("a", 100, 700, 120);
  const at = placeCard({ elements: [last], lastId: "a", view });
  assert.deepEqual(at, { x: 600 - CARD_WIDTH / 2, y: 400 - CARD_HEIGHT / 2 });
});

test("a deleted last card no longer anchors the next", () => {
  const last = { ...card("a", 100, 100), isDeleted: true };
  const at = placeCard({ elements: [last], lastId: "a", view });
  assert.deepEqual(at, { x: 600 - CARD_WIDTH / 2, y: 400 - CARD_HEIGHT / 2 });
});

test("a dropped card is centred on the drop point", () => {
  const at = placeCard({ elements: [], view, drop: { x: 500, y: 300 } });
  assert.deepEqual(at, { x: 500 - CARD_WIDTH / 2, y: 300 - CARD_HEIGHT / 2 });
});

test("a new card never lands on another card: it moves down until it is clear", () => {
  const middle = card("m", 600 - CARD_WIDTH / 2, 400 - CARD_HEIGHT / 2, 120);
  const below = card("b", middle.x + 50, middle.y + 120 + CARD_GAP, 100);
  const at = placeCard({ elements: [middle, below], view });
  const placed = { ...at, width: CARD_WIDTH, height: CARD_HEIGHT };
  assert.ok(!overlaps(placed, middle) && !overlaps(placed, below));
  assert.equal(at.x, middle.x);
});

test("a card takes its content's height", () => {
  const fitted = fitCard([card("a", 0, 0, 150)], "a", 132);
  assert.equal(fitted.find((e) => e.id === "a").height, 132);
});

test("a height within a pixel or two changes nothing", () => {
  assert.equal(fitCard([card("a", 0, 0, 150)], "a", 151), null);
  assert.equal(fitCard([card("a", 0, 0, 150)], "missing", 200), null);
});

test("a card that grows pushes the cards it would cover down, and those under them", () => {
  const a = card("a", 0, 0, 100);
  const b = card("b", 0, 100 + CARD_GAP, 100);
  const c = card("c", 0, 100 + CARD_GAP + 100 + CARD_GAP, 100);
  const aside = card("d", 1000, 120, 100);
  const fitted = fitCard([a, b, c, aside], "a", 160);
  const byId = Object.fromEntries(fitted.map((e) => [e.id, e]));
  assert.ok(!overlaps(byId.a, byId.b) && !overlaps(byId.b, byId.c));
  assert.equal(byId.b.y, 160 + CARD_GAP);
  assert.equal(byId.d.y, 120, "a card that was clear stays put");
});

test("cards that already overlapped are left where the researcher put them", () => {
  const a = card("a", 0, 0, 100);
  const b = card("b", 20, 50, 100);
  const fitted = fitCard([a, b], "a", 140);
  assert.equal(fitted.find((e) => e.id === "b").y, 50);
});

test("the cards an arrow would bind to, from either form of suggested binding", () => {
  const a = card("a", 0, 0);
  const b = card("b", 0, 300);
  const box = { id: "r", type: "rectangle" };
  const ids = suggestedCardIds({ suggestedBindings: [a, [{ id: "arrow" }, "end", b], box] });
  assert.deepEqual([...ids].sort(), ["a", "b"]);
  assert.equal(suggestedCardIds({}).size, 0);
});

test("an Artifact draws each card as an image at its size on screen, after every other element, keeping its source", () => {
  const a = card("a", 10, 20, 140);
  const arrow = { id: "arrow", type: "arrow", x: 0, y: 0, width: 50, height: 50, isDeleted: false };
  const b = card("b", 500, 20, 120);
  const { elements, files } = artifactScene([a, arrow, b], { f0: { id: "f0" } }, {
    a: "data:image/png;base64,AAA",
    b: "data:image/png;base64,BBB",
  });
  assert.deepEqual(elements.map((e) => e.type), ["arrow", "image", "image"]);
  const image = elements[1];
  assert.deepEqual([image.id, image.x, image.y, image.width, image.height], ["a", 10, 20, CARD_WIDTH, 140]);
  assert.equal(image.link, "marasi://finding/a");
  assert.deepEqual(image.customData, { source: { kind: "finding", id: "a" } });
  assert.equal(files[image.fileId].dataURL, "data:image/png;base64,AAA");
  assert.equal(files[image.fileId].mimeType, "image/png");
  assert.ok(files.f0, "the drawing's own files stay");
});

test("when the middle's column is full down past the view, the card goes in a free column beside it", () => {
  const x = 600 - CARD_WIDTH / 2;
  const column = [0, 1, 2, 3].map((i) => card(`c${i}`, x, 100 + i * 180, 170));
  const at = placeCard({ elements: column, view });
  const placed = { ...at, width: CARD_WIDTH, height: CARD_HEIGHT };
  assert.ok(column.every((c) => !overlaps(placed, c)));
  assert.ok(at.y + CARD_HEIGHT <= view.height, "it stays in view");
  assert.notEqual(at.x, x);
});
