// Cards (GLOSSARY: Card) on a Drawing: pairs, findings and test cases as
// Excalidraw embeddables that the app draws itself (CardView.svelte), over
// the canvas and outside its dark-mode filter (docs/adr/2026-11-21-
// excalidraw-is-a-react-island-and-cards-are-the-apps-own-markup.md).
// Plain functions over Excalidraw's element JSON, so they load under node.
//
// A card's element has `link` marasi://<kind>/<id> and
// `customData.source = { kind, id }`; a pair card also keeps the pair's row
// as `customData.last`, so it renders when the pair is outside any loaded
// page. Its shape has a solid fill (hidden under the card) and no
// roundness, so arrows bind anywhere over its area, not only its outline.

export const CARD_KINDS = ["pair", "finding", "testCase"];
/** The drag data type of an Insert panel row: JSON { source, last }. */
export const DRAG_TYPE = "application/x-marasi-source";
export const CARD_WIDTH = 380;
/** A new card's height until it reports its content's. */
export const CARD_HEIGHT = 150;
/** The space between cards stacked one under another. */
export const CARD_GAP = 16;

/** The parts of its pair a pair card can hold, with their names. */
export const PART_NAMES = { request: "Request", response: "Response", both: "Request + Response" };
/** A pair card's view when its element has none. */
export const DEFAULT_VIEW = Object.freeze({ part: "request", expanded: false });

export const linkOf = (source) => `marasi://${source.kind}/${source.id}`;

/** The { kind, id } a marasi:// link names, or null. */
export function sourceOfLink(link) {
  const match = /^marasi:\/\/(pair|finding|testCase)\/(.+)$/.exec(link ?? "");
  return match ? { kind: match[1], id: match[2] } : null;
}

/** A live element's card source, or null when it is no card. */
export function cardSource(element) {
  if (!element || element.isDeleted || element.type !== "embeddable") return null;
  const source = element.customData?.source;
  return source && CARD_KINDS.includes(source.kind) ? { kind: source.kind, id: source.id } : null;
}

export const isCard = (element) => cardSource(element) !== null;

/**
 * A pair card's view, `customData.view`: which part of its pair it shows
 * and whether it is expanded. A missing view, or a part it doesn't know,
 * reads as DEFAULT_VIEW, so drawings from before views load unchanged.
 */
export function cardView(element) {
  const view = element?.customData?.view;
  if (!view || !PART_NAMES[view.part]) return { ...DEFAULT_VIEW };
  return { part: view.part, expanded: Boolean(view.expanded) };
}

/** Card `element`'s customData with `change` ({ part?, expanded? }) made to its view. */
export function withCardView(element, change) {
  return { ...element.customData, view: { ...cardView(element), ...change } };
}

const randomInt = () => Math.floor(Math.random() * 2 ** 31);
const randomId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? `card-${crypto.randomUUID()}`
    : `card-${Date.now().toString(36)}-${randomInt().toString(36)}`;

/**
 * A complete card element for `source` with its top-left at `at`. `last`
 * is a pair's row. Excalidraw restores the rest (its fractional index) when
 * the scene loads.
 */
export function newCardElement(source, at, { last = null, width = CARD_WIDTH, height = CARD_HEIGHT } = {}) {
  return {
    id: randomId(),
    type: "embeddable",
    x: at.x,
    y: at.y,
    width,
    height,
    angle: 0,
    strokeColor: "transparent",
    // Hidden under the card; a solid fill makes the whole area bindable.
    backgroundColor: "#ffffff",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: linkOf(source),
    locked: false,
    customData: { source: { kind: source.kind, id: source.id }, ...(last ? { last } : {}) },
  };
}

const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Moves `box` down, under whichever card it lands on, until it is clear.
function clearOfCards(box, elements) {
  const cards = elements.filter(isCard);
  let at = { ...box };
  for (let moved = true, guard = 0; moved && guard < 500; guard++) {
    moved = false;
    for (const other of cards) {
      if (overlaps(at, other)) {
        at = { ...at, y: other.y + other.height + CARD_GAP };
        moved = true;
      }
    }
  }
  return { x: at.x, y: at.y };
}

/**
 * Where a new card's top-left goes. `view` is the visible part of the scene,
 * in scene coordinates. A dropped card is centred on `drop`. Otherwise it
 * goes under the card added last (`lastId`, at the height it has now) while
 * that spot is still in view, else in the middle of the view. It never lands
 * on another card.
 */
export function placeCard({ elements, view, lastId = null, drop = null, width = CARD_WIDTH, height = CARD_HEIGHT }) {
  const box = (x, y) => clearOfCards({ x, y, width, height }, elements);
  if (drop) return box(drop.x - width / 2, drop.y - height / 2);
  const last = lastId ? elements.find((element) => element.id === lastId && isCard(element)) : null;
  if (last) {
    const spot = { x: last.x, y: last.y + last.height + CARD_GAP };
    const inView =
      spot.x >= view.x &&
      spot.x + Math.min(width, view.width) <= view.x + view.width &&
      spot.y >= view.y &&
      spot.y + Math.min(height, view.height) <= view.y + view.height;
    if (inView) return box(spot.x, spot.y);
  }
  // The middle; when cards push it down out of view, the nearest column
  // beside it that has room in view.
  const x = view.x + view.width / 2 - width / 2;
  const y = view.y + view.height / 2 - height / 2;
  const first = box(x, y);
  if (first.y + height <= view.y + view.height) return first;
  const step = width + CARD_GAP;
  for (let i = 1; i * step < view.width; i++) {
    for (const dx of [i * step, -i * step]) {
      const left = x + dx;
      if (left < view.x || left + width > view.x + view.width) continue;
      const at = box(left, y);
      if (at.y + height <= view.y + view.height) return at;
    }
  }
  return first;
}

/**
 * The elements with card `id` at its content's `height`, or null when that
 * changes nothing. A card that grows moves the cards it would newly cover
 * down, and those they would then cover; cards the researcher overlapped
 * on purpose stay. The caller applies the result outside the undo history.
 */
export function fitCard(elements, id, height) {
  const card = elements.find((element) => element.id === id && isCard(element));
  if (!card || !(height > 0) || Math.abs(card.height - height) < 2) return null;
  const moved = new Map([[id, { ...card, height }]]);
  const current = (element) => moved.get(element.id) ?? element;
  const queue = [id];
  while (queue.length) {
    const pusher = moved.get(queue.shift());
    for (const other of elements) {
      if (other.id === pusher.id || !isCard(other) || other.id === id) continue;
      const before = elements.find((element) => element.id === pusher.id);
      const now = current(other);
      if (!overlaps(pusher, now) || overlaps(before, other)) continue;
      moved.set(other.id, { ...now, y: pusher.y + pusher.height + CARD_GAP });
      queue.push(other.id);
    }
  }
  return elements.map(current);
}

/**
 * The ids of the cards an arrow being drawn would bind to, from
 * Excalidraw's appState.suggestedBindings (each an element, or
 * [arrow, end, element]). Excalidraw draws that hint under the card, so the
 * card draws its own ring.
 */
export function suggestedCardIds(appState) {
  const ids = new Set();
  for (const binding of appState?.suggestedBindings ?? []) {
    const element = Array.isArray(binding) ? binding[2] : binding;
    if (isCard(element)) ids.add(element.id);
  }
  return ids;
}

/**
 * The scene a Drawing's Artifact exports: each card replaced by an image of
 * it (`cardImages`, element id → a PNG data URL drawn light at the card's
 * size on screen), drawn after every other element, as cards sit above the
 * canvas on screen. Each image keeps its card's `link` and `customData`, so
 * the scene embedded in the file still names every card's source. Returns
 * { elements, files } without changing its input.
 */
export function artifactScene(elements, files, cardImages) {
  const outFiles = { ...files };
  const others = [];
  const images = [];
  for (const element of elements) {
    const dataURL = isCard(element) ? cardImages[element.id] : null;
    if (!dataURL) {
      if (!element.isDeleted) others.push(element);
      continue;
    }
    const fileId = `marasi-card-${element.id}`;
    outFiles[fileId] = { id: fileId, dataURL, mimeType: "image/png", created: Date.now() };
    images.push({
      ...element,
      type: "image",
      fileId,
      status: "saved",
      scale: [1, 1],
      crop: null,
      backgroundColor: "transparent",
    });
  }
  return { elements: [...others, ...images], files: outFiles };
}

/** How far outside a card's edge a bound arrow's tip sits, so its head shows. */
export const ARROW_GAP = 4;

const rotate = ([x, y], [cx, cy], angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
};

// Where the ray from `from` along `dir` first meets `box`, or null.
function rayEntry(from, dir, box) {
  let near = 0;
  let far = Infinity;
  for (const [axis, min, max] of [
    [0, box.x, box.x + box.width],
    [1, box.y, box.y + box.height],
  ]) {
    if (Math.abs(dir[axis]) < 1e-9) {
      if (from[axis] < min || from[axis] > max) return null;
      continue;
    }
    let t1 = (min - from[axis]) / dir[axis];
    let t2 = (max - from[axis]) / dir[axis];
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
  }
  return near <= far ? [from[0] + dir[0] * near, from[1] + dir[1] * near] : null;
}

// The scene point an arrow end bound to `card` belongs at, given the end's
// point now and the arrow's point next to it: where the line from that
// point toward the end meets the card's edge, ARROW_GAP outside it (toward
// the card's middle when the line misses it). Null when the other point is
// on the card itself. `aimed` says whether the line hit.
function edgePoint(card, end, other) {
  const centre = [card.x + card.width / 2, card.y + card.height / 2];
  const angle = card.angle ?? 0;
  const from = rotate(other, centre, -angle);
  const to = rotate(end, centre, -angle);
  const box = { x: card.x - ARROW_GAP, y: card.y - ARROW_GAP, width: card.width + 2 * ARROW_GAP, height: card.height + 2 * ARROW_GAP };
  const inside = from[0] >= box.x && from[0] <= box.x + box.width && from[1] >= box.y && from[1] <= box.y + box.height;
  if (inside) return null;
  let aimed = true;
  let hit = rayEntry(from, [to[0] - from[0], to[1] - from[1]], box);
  if (!hit) {
    aimed = false;
    hit = rayEntry(from, [centre[0] - from[0], centre[1] - from[1]], box);
  }
  return hit ? { point: rotate(hit, centre, angle), aimed } : null;
}

/**
 * The arrows whose ends bound to a card aren't on its edge, each with those
 * ends moved there. Excalidraw keeps the tip where it was let go, which over
 * a card is under it, hiding the head; on the edge it shows, on screen and
 * in an Artifact. Elbow arrows (which Excalidraw snaps itself) and arrows
 * bound to no card are left alone. The caller applies the result outside
 * the undo history.
 */
export function cardArrowEnds(elements) {
  const cards = new Map(elements.filter(isCard).map((card) => [card.id, card]));
  if (!cards.size) return [];
  const fixed = [];
  for (const arrow of elements) {
    if (arrow.type !== "arrow" || arrow.isDeleted || arrow.elbowed || arrow.points.length < 2) continue;
    const global = arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py]);
    const bindings = {};
    let changed = false;
    for (const [key, index, other] of [
      ["startBinding", 0, 1],
      ["endBinding", global.length - 1, global.length - 2],
    ]) {
      const binding = arrow[key];
      const card = binding && cards.get(binding.elementId);
      if (!card) continue;
      const edge = edgePoint(card, global[index], global[other]);
      if (!edge) continue;
      const moved = Math.hypot(edge.point[0] - global[index][0], edge.point[1] - global[index][1]) > 0.5;
      if (!moved && binding.gap === ARROW_GAP) continue;
      if (moved) global[index] = edge.point;
      bindings[key] = { ...binding, gap: ARROW_GAP, ...(edge.aimed ? {} : { focus: 0 }) };
      changed = true;
    }
    if (!changed) continue;
    const [x, y] = global[0];
    const points = global.map(([gx, gy]) => [gx - x, gy - y]);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    fixed.push({
      ...arrow,
      ...bindings,
      x,
      y,
      points,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });
  }
  return fixed;
}
