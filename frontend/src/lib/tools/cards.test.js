import { test } from "node:test";
import assert from "node:assert/strict";
import { ARROW_GAP, artifactScene, cardArrowEnds, suggestedCardIds, CARD_GAP, CARD_HEIGHT, CARD_WIDTH, cardSource, cardView, fitCard, viewChanges, newCardElement, placeCard, sourceOfLink, withCardView } from "./cards.js";

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

test("a card the researcher expands moves every card below it in its columns down by its growth, keeping their spacing", () => {
  // `a` expands from 120 to 520: `b` (well clear of it), `c` (under `b`)
  // and `under` (overlapping its width only in part) keep their gaps to it.
  const a = card("a", 0, 0, 120);
  const b = card("b", 0, 600, 120);
  const c = card("c", 0, 900, 120);
  const under = card("under", CARD_WIDTH - 40, 300, 100);
  const aside = card("aside", CARD_WIDTH + 100, 200, 100);
  const above = card("above", 0, -300, 100);
  const byId = Object.fromEntries(fitCard([a, b, c, under, aside, above], "a", 520, { push: true }).map((e) => [e.id, e]));
  assert.equal(byId.a.height, 520);
  assert.equal(byId.b.y, 1000);
  assert.equal(byId.c.y, 1300);
  assert.equal(byId.under.y, 700);
  assert.equal(byId.aside.y, 200, "a card beside it stays");
  assert.equal(byId.above.y, -300, "a card above it stays");
});

test("a card an expand moves down moves the cards below it too, so none ends up covered", () => {
  // `side` isn't under `a`, but is under `b`, which `a` moves onto it.
  const a = card("a", 0, 0, 100);
  const b = card("b", 200, 150, 100);
  const side = card("side", CARD_WIDTH + 50, 300, 100);
  const byId = Object.fromEntries(fitCard([a, b, side], "a", 300, { push: true }).map((e) => [e.id, e]));
  assert.equal(byId.b.y, 350);
  assert.equal(byId.side.y, 500);
});

test("a pair card whose content loads moves only the cards it would cover, as before views", () => {
  // A collapsed pair card's first lines arrive as a drawing opens: `clear`,
  // well below it, stays; `tight`, which it would cover, moves just under it.
  const pair = (id, x, y, height) => ({ ...newCardElement({ kind: "pair", id }, { x, y }, { height }), id });
  const a = pair("a", 0, 0, 150);
  const clear = pair("clear", 0, 600, 120);
  const beside = pair("beside", CARD_WIDTH + 50, 0, 100);
  const tight = pair("tight", 0, 150 + CARD_GAP, 100);
  const byId = Object.fromEntries(fitCard([a, clear, beside, tight], "a", 200).map((e) => [e.id, e]));
  assert.equal(byId.clear.y, 600, "a card clear of it stays");
  assert.equal(byId.beside.y, 0, "a card beside it stays");
  assert.equal(byId.tight.y, 200 + CARD_GAP, "a card it would cover moves just under it");
});

test("a finding card that grows moves only the cards it would cover", () => {
  const f = card("f", 0, 0, 150);
  const below = card("below", 0, 400, 120);
  const byId = Object.fromEntries(fitCard([f, below], "f", 300).map((e) => [e.id, e]));
  assert.equal(byId.f.height, 300);
  assert.equal(byId.below.y, 400);
});

test("a card's size pushes only when it follows a change to its view", () => {
  const changed = viewChanges();
  assert.equal(changed({ part: "request", expanded: false }), false, "the first size, as the card opens");
  assert.equal(changed({ part: "request", expanded: false }), false, "its content loading, in the same view");
  assert.equal(changed({ part: "request", expanded: true }), true, "Details");
  assert.equal(changed({ part: "request", expanded: true }), false, "a later fit in the same view");
  assert.equal(changed({ part: "both", expanded: true }), true, "a part switch");
});

test("a card that shrinks moves no other card", () => {
  const a = card("a", 0, 0, 500);
  const b = card("b", 0, 600, 120);
  const fitted = fitCard([a, b], "a", 120, { push: true });
  assert.equal(fitted.find((e) => e.id === "a").height, 120);
  assert.equal(fitted.find((e) => e.id === "b").y, 600);
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

// A card at (100, 100), 200 × 100, and an arrow from `from` to `to`
// (scene points) with its end bound to it, as Excalidraw leaves one dropped
// over the card.
function boundArrow(from, to, { bound = "end" } = {}) {
  const card = { ...newCardElement({ kind: "finding", id: "f-1" }, { x: 100, y: 100 }, { width: 200, height: 100 }), id: "card" };
  const binding = { elementId: "card", focus: 0, gap: 40 };
  const arrow = {
    id: "arrow",
    type: "arrow",
    x: from.x,
    y: from.y,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
    angle: 0,
    points: [
      [0, 0],
      [to.x - from.x, to.y - from.y],
    ],
    isDeleted: false,
    startBinding: bound === "start" ? binding : null,
    endBinding: bound === "end" ? binding : null,
    elbowed: false,
  };
  return [card, arrow];
}

const endOf = (arrow) => {
  const [dx, dy] = arrow.points[arrow.points.length - 1];
  return [arrow.x + dx, arrow.y + dy];
};

test("an arrow bound to a point inside a card ends on the card's edge, toward its other point", () => {
  const [card, arrow] = boundArrow({ x: 0, y: 150 }, { x: 200, y: 150 });
  const [fixed] = cardArrowEnds([card, arrow]);
  assert.equal(fixed.id, "arrow");
  assert.deepEqual(endOf(fixed).map(Math.round), [100 - ARROW_GAP, 150]);
  assert.deepEqual([fixed.x, fixed.y], [0, 150]);
  assert.equal(fixed.endBinding.gap, ARROW_GAP);
});

test("an arrow's start bound inside a card moves to the edge facing its end, and its end stays", () => {
  const [card, arrow] = boundArrow({ x: 250, y: 180 }, { x: 250, y: 400 }, { bound: "start" });
  const [fixed] = cardArrowEnds([card, arrow]);
  assert.deepEqual([fixed.x, fixed.y].map(Math.round), [250, 200 + ARROW_GAP]);
  assert.deepEqual(endOf(fixed).map(Math.round), [250, 400]);
  assert.equal(fixed.startBinding.gap, ARROW_GAP);
});

test("an arrow already on its card's edge, or bound to no card, is left alone", () => {
  const [card, arrow] = boundArrow({ x: 0, y: 150 }, { x: 200, y: 150 });
  const [fixed] = cardArrowEnds([card, arrow]);
  assert.deepEqual(cardArrowEnds([card, fixed]), []);
  const rectangle = { ...card, type: "rectangle", customData: undefined };
  assert.deepEqual(cardArrowEnds([rectangle, arrow]), []);
  // Under a card but bound to nothing: it stays hidden under the card.
  assert.deepEqual(cardArrowEnds([card, { ...arrow, endBinding: null }]), []);
});

test("after its card moves away, a bound arrow's end goes back to the card's edge", () => {
  const [card, arrow] = boundArrow({ x: 0, y: 150 }, { x: 200, y: 150 });
  const [onEdge] = cardArrowEnds([card, arrow]);
  const moved = { ...card, x: 300, y: 120 };
  const [fixed] = cardArrowEnds([moved, onEdge]);
  // The line from (0, 150) through the old tip still meets the moved card.
  assert.deepEqual(endOf(fixed).map(Math.round), [300 - ARROW_GAP, 150]);
  // A card moved off that line: the end aims at the card's middle.
  const far = { ...card, x: 100, y: 400 };
  const [aimed] = cardArrowEnds([far, onEdge]);
  const [ex, ey] = endOf(aimed);
  assert.ok(ey <= 400 - ARROW_GAP + 0.5 && ey >= 400 - ARROW_GAP - 0.5, `end y ${ey}`);
  assert.ok(ex > 100 && ex < 300, `end x ${ex}`);
  assert.equal(aimed.endBinding.focus, 0);
});

test("an arrow whose other point is on the card itself is left alone", () => {
  const [card, arrow] = boundArrow({ x: 150, y: 150 }, { x: 200, y: 150 });
  assert.deepEqual(cardArrowEnds([card, arrow]), []);
});

test("a new pair card, or one loaded without a view, shows the request, collapsed", () => {
  const card = newCardElement({ kind: "pair", id: "p-1" }, { x: 0, y: 0 }, { last: pairRow });
  assert.equal(card.customData.view, undefined);
  assert.deepEqual(cardView(card), { part: "request", expanded: false });
  assert.deepEqual(cardView({ ...card, customData: { source: card.customData.source } }), { part: "request", expanded: false });
});

test("a pair card's view is read from its customData, with an unknown part read as the request", () => {
  const card = newCardElement({ kind: "pair", id: "p-1" }, { x: 0, y: 0 });
  const both = { ...card, customData: { ...card.customData, view: { part: "both", expanded: true } } };
  assert.deepEqual(cardView(both), { part: "both", expanded: true });
  const odd = { ...card, customData: { ...card.customData, view: { part: "headers" } } };
  assert.deepEqual(cardView(odd), { part: "request", expanded: false });
});

test("a card's view changes on a copy of its customData that keeps its source and row", () => {
  const card = newCardElement({ kind: "pair", id: "p-1" }, { x: 0, y: 0 }, { last: pairRow });
  const customData = withCardView(card, { part: "response" });
  assert.deepEqual(customData, { source: { kind: "pair", id: "p-1" }, last: pairRow, view: { part: "response", expanded: false } });
  assert.equal(card.customData.view, undefined);
});
