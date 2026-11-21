// Cards on a drawing, as the Excalidraw island draws them: the `embed` it
// takes (CardView over each card embeddable), each card fitted to its
// content outside the undo history, and the ring while an arrow would bind.
// The Excalidraw page and the tool contract checks' harness both use it.
import { get, writable } from "svelte/store";
import CardView from "./CardView.svelte";
import { cardSource, fitCard, sourceOfLink, suggestedCardIds } from "./cards.js";

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

  const embed = {
    accepts: (link) => sourceOfLink(link) !== null,
    mount(target, element) {
      let latest = element;
      const view = new CardView({
        target,
        props: {
          source: cardSource(element) ?? sourceOfLink(element.link),
          last: element.customData?.last ?? null,
          suggested: get(suggested).has(element.id),
          onOpen: () => onOpen(cardSource(latest) ?? sourceOfLink(latest.link), latest.customData?.last),
          onSize: (height) => fitToContent(latest.id, height),
        },
      });
      const unsubscribe = suggested.subscribe((ids) => view.$set({ suggested: ids.has(latest.id) }));
      return {
        update(next) {
          latest = next;
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
    /** Call from api.onChange: rings the cards an arrow being drawn would bind to. */
    noteChange(appState) {
      const ids = suggestedCardIds(appState);
      const now = get(suggested);
      if (ids.size !== now.size || [...ids].some((id) => !now.has(id))) suggested.set(ids);
    },
  };
}
