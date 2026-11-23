// Add to Drawing: the pair goes on a drawing as a card (the last-opened one,
// unless a menu picked another),
// carrying its row so it renders outside any loaded page, and a jump toast
// opens the drawing. The global action (its shortcut, ⌘K and the Ledger
// drawer's rail, which runs it through the dispatcher) is addOpenPairToDrawing;
// the Ledger row menu passes the row it was opened on.
import { goto } from "$app/navigation";
import { get } from "svelte/store";
import { modeCurrent } from "@skeletonlabs/skeleton";
import { toastJump } from "../toasts.js";
import { focusedPair, ledgerStore } from "../../stores/ledgerStore";
import { drawingCards, drawings } from "./documents.js";

/** global.add-to-drawing: the Ledger drawer's pair, while the Ledger is the page at `pathname`. */
export function addOpenPairToDrawing(toastStore, pathname) {
  addPairToDrawing(toastStore, pathname.startsWith("/ledger") ? focusedPair(get(ledgerStore)) : null);
}

/**
 * Adds `pair` as a card on drawing `target` (a drawing id, "new", or null for
 * the last-opened drawing). The toast's Open opens that drawing.
 */
export function addPairToDrawing(toastStore, pair, target = null) {
  if (!pair) {
    toastStore.trigger({ message: "Open a pair first", background: "variant-filled-warning" });
    return;
  }
  const { drawing } = drawingCards.add({ kind: "pair", id: pair.ID }, { last: pair, target });
  toastJump(toastStore, `Added #${pair.Number} to ${drawing.name}`, "Open", get(modeCurrent), () => {
    drawings.open(drawing.id);
    goto("/excalidraw");
  });
}
