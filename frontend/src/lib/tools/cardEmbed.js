// Cards on a drawing, as the Excalidraw island draws them: the `embed` it
// takes (CardView over each card embeddable), each card fitted to its
// content outside the undo history, the ring while an arrow would bind, the
// arrows bound to a card kept on its edge, and a pair card's view (its
// REQ · BOTH · RES switch) changed in the undo history.
// The Excalidraw page and the tool contract checks' harness both use it.
import { get, writable } from "svelte/store";
import CardView from "./CardView.svelte";
import { cardArrowEnds, cardSource, cardView, fitCard, sourceOfLink, suggestedCardIds, withCardView } from "./cards.js";

/**
 * `excalidraw()` returns { api, lib } once Excalidraw is up, else null.
 * `onOpen(source, last)` is a card's Open ↗.
 */
export function createCardEmbed({ excalidraw, onOpen = () => {} }) {
  const suggested = writable(new Set());

  // A card takes its content's height, outside the undo history, pushing
  // down the cards it would cover.
  function fitToContent(id, height) {
    const up = excalidraw();
    if (!up) return;
    const { api, lib } = up;
    const elements = api.getSceneElementsIncludingDeleted();
    const fitted = fitCard(elements, id, height);
    if (!fitted) return;
    const next = fitted.map((element, i) => {
      const before = elements[i];
      return element === before || (element.y === before.y && element.height === before.height)
        ? before
        : lib.newElementWith(before, { y: element.y, height: element.height });
    });
    api.updateScene({ elements: next, captureUpdate: lib.CaptureUpdateAction.NEVER });
  }

  // A pair card's switch: its view changes in the undo history, so undo
  // takes it back; the fit that follows stays outside it.
  function changeView(id, change) {
    const up = excalidraw();
    if (!up) return;
    const { api, lib } = up;
    const elements = api.getSceneElementsIncludingDeleted();
    const next = elements.map((element) =>
      element.id === id && cardSource(element) ? lib.newElementWith(element, { customData: withCardView(element, change) }) : element,
    );
    api.updateScene({ elements: next, captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
  }

  // While a pointer is down or an element is being drawn, moved or resized,
  // the researcher's gesture owns the scene.
  const gesturing = (appState) =>
    appState.cursorButton === "down" ||
    appState.newElement ||
    appState.multiElement ||
    appState.resizingElement ||
    appState.selectedElementsAreBeingDragged ||
    appState.selectedLinearElement?.isDragging ||
    appState.editingLinearElement?.isDragging;

  // Arrow ends bound to a card go to its edge (cards.js cardArrowEnds), so
  // the card doesn't hide their heads. Outside the undo history, so undo
  // takes the arrow's own edit back in one step.
  let snapping = false;
  function snapArrows() {
    snapping = false;
    const up = excalidraw();
    if (!up) return;
    const { api, lib } = up;
    if (gesturing(api.getAppState())) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const fixed = new Map(cardArrowEnds(elements).map((arrow) => [arrow.id, arrow]));
    if (!fixed.size) return;
    const next = elements.map((element) => {
      const arrow = fixed.get(element.id);
      if (!arrow) return element;
      const { x, y, points, width, height, startBinding, endBinding } = arrow;
      return lib.newElementWith(element, { x, y, points, width, height, startBinding, endBinding });
    });
    api.updateScene({ elements: next, captureUpdate: lib.CaptureUpdateAction.NEVER });
  }

  const embed = {
    accepts: (link) => sourceOfLink(link) !== null,
    mount(target, element) {
      let latest = element;
      let shown = cardView(element);
      const view = new CardView({
        target,
        props: {
          source: cardSource(element) ?? sourceOfLink(element.link),
          last: element.customData?.last ?? null,
          view: shown,
          suggested: get(suggested).has(element.id),
          onOpen: () => onOpen(cardSource(latest) ?? sourceOfLink(latest.link), latest.customData?.last),
          onSize: (height) => fitToContent(latest.id, height),
          onView: (change) => changeView(latest.id, change),
        },
      });
      const unsubscribe = suggested.subscribe((ids) => view.$set({ suggested: ids.has(latest.id) }));
      return {
        update(next) {
          latest = next;
          const now = cardView(next);
          if (now.part !== shown.part || now.expanded !== shown.expanded) {
            shown = now;
            view.$set({ view: now });
          }
        },
        destroy() {
          unsubscribe();
          view.$destroy();
        },
      };
    },
  };

  return {
    embed,
    /**
     * Call from api.onChange: rings the cards an arrow being drawn would
     * bind to, and once no gesture is under way, moves arrow ends bound to
     * a card onto its edge.
     */
    noteChange(elements, appState) {
      const ids = suggestedCardIds(appState);
      const now = get(suggested);
      if (ids.size !== now.size || [...ids].some((id) => !now.has(id))) suggested.set(ids);
      if (!snapping && !gesturing(appState) && cardArrowEnds(elements).length) {
        snapping = true;
        queueMicrotask(snapArrows);
      }
    },
  };
}
