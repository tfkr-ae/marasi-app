// Add to Drawing (global.add-to-drawing, the Ledger drawer and row menu):
// the pair goes on the last-opened drawing as a card, carrying its row so it
// renders outside any loaded page, and a jump toast opens the drawing.
import { goto } from "$app/navigation";
import { get } from "svelte/store";
import { modeCurrent } from "@skeletonlabs/skeleton";
import { toastJump } from "../toasts.js";
import { drawingCards } from "./documents.js";

export function addPairToDrawing(toastStore, pair) {
  if (!pair) {
    toastStore.trigger({ message: "Open a pair first", background: "variant-filled-warning" });
    return;
  }
  const { drawing } = drawingCards.add({ kind: "pair", id: pair.ID }, { last: pair });
  toastJump(toastStore, `Added #${pair.Number} to ${drawing.name}`, "Open", get(modeCurrent), () => goto("/excalidraw"));
}
