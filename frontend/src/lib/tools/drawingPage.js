// The Excalidraw page's logic over the canvas on screen: keeping the rows
// of its pair cards live, adding a card where it belongs, and Open ↗ on a
// card. Plain functions over what the page passes in, so node can test them;
// routes/excalidraw/+page.svelte binds them to the app.
import { cardSource, newCardElement, placeCard } from "./cards.js";
import { FALLBACK_VIEWPORT, sceneView } from "./drawingCards.js";

/**
 * `pairRows` is { track(ids) → stop, rows() → { id: row } }; `drawingCards`
 * the app's (drawingCards.js); `setCanvasSize(size)` records the canvas's
 * size for Add to Drawing; `goto(path)`, `ledger.goToNumber(n)` and
 * `logbook.open(kind, id)` go to a card's source.
 */
export function createDrawingPage({ pairRows, drawingCards, setCanvasSize, goto, ledger, logbook }) {
  let trackedKey = null;
  let stop = () => {};

  return {
    /** Keeps the rows of the pairs on the drawing's `elements` live. */
    trackPairs(elements) {
      const ids = elements
        .map(cardSource)
        .filter((source) => source?.kind === "pair")
        .map((source) => String(source.id))
        .sort();
      const key = ids.join(",");
      if (key === trackedKey) return;
      trackedKey = key;
      const previous = stop;
      stop = pairRows.track(ids);
      previous();
    },

    stopTracking() {
      stop();
      stop = () => {};
      trackedKey = null;
    },

    /**
     * Adds a card for `source` (with a pair's `last` row) to the drawing on
     * screen, centred on `drop` when dropped. `size` is the canvas's, or
     * null when unknown. Returns the element added.
     */
    addCard({ api, lib, drawingId, size }, source, last = null, drop = null) {
      if (size) setCanvasSize(size);
      const elements = api.getSceneElementsIncludingDeleted();
      const at = placeCard({
        elements,
        view: sceneView(api.getAppState(), size ?? FALLBACK_VIEWPORT),
        lastId: drawingCards.lastCardId(drawingId),
        drop,
      });
      const [element] = lib.restoreElements([newCardElement(source, at, { last })], null);
      drawingCards.noteAdded(drawingId, element.id);
      api.updateScene({ elements: [...elements, element], captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
      return element;
    },

    /** Open ↗: the pair in the Ledger, or the record in the Logbook. */
    async openSource(source, last) {
      if (source.kind === "pair") {
        const number = pairRows.rows()[String(source.id)]?.Number ?? last?.Number;
        await goto("/ledger");
        if (number != null) ledger.goToNumber(number);
        return;
      }
      logbook.open(source.kind, source.id);
      await goto("/logbook");
    },
  };
}
