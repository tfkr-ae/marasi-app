// Adding cards to the open project's Drawings, from the Excalidraw page's
// Insert panel and from Add to Drawing on other pages. It remembers the card
// added last on each drawing, so the next goes under it (placeCard).
import { newCardElement, placeCard } from "./cards.js";

/** The part of the scene a viewport of `size` shows at `appState`'s scroll and zoom. */
export function sceneView(appState, size) {
  const zoom = appState?.zoom?.value || 1;
  return {
    x: -(appState?.scrollX ?? 0),
    y: -(appState?.scrollY ?? 0),
    width: size.width / zoom,
    height: size.height / zoom,
  };
}

/**
 * `drawings` is the toolDocuments drawing collection. `viewport()` is the
 * canvas's size in pixels for a drawing that isn't on screen.
 */
export function createDrawingCards(drawings, { viewport }) {
  const lastCards = new Map();

  return {
    lastCardId: (drawingId) => lastCards.get(drawingId) ?? null,
    noteAdded(drawingId, elementId) {
      lastCards.set(drawingId, elementId);
    },
    /**
     * Adds a card for `source` to the last-opened drawing's stored scene,
     * which the page shows when it next opens. `last` is a pair's row.
     * Returns { drawing, element }.
     */
    add(source, { last = null } = {}) {
      const drawing = drawings.current();
      const elements = drawing.scene?.elements ?? [];
      const at = placeCard({
        elements,
        view: sceneView(drawing.scene?.appState, viewport()),
        lastId: lastCards.get(drawing.id) ?? null,
      });
      const element = newCardElement(source, at, { last });
      drawings.change(drawing.id, {
        scene: { appState: {}, ...drawing.scene, elements: [...elements, element] },
      });
      lastCards.set(drawing.id, element.id);
      return { drawing, element };
    },
  };
}
