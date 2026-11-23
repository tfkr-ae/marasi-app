// Send to CyberChef's app side: the editor tracker on the document, and
// sending, which queues the text for the CyberChef page and goes there.
// The pure parts are in send.js.
import { goto } from "$app/navigation";
import { EditorView } from "@codemirror/view";
import { chefInbox, editorTracker, textOfEditor } from "./send.js";
import { recipes } from "../documents.js";

const findView = (el) => EditorView.findFromDOM(el);
const tracker = editorTracker(findView);

/** Starts tracking the last focused editor. Returns the stop function. */
export function trackEditors(doc = document) {
  const onFocusIn = (event) => tracker.focused(event.target);
  doc.addEventListener("focusin", onFocusIn, true);
  return () => doc.removeEventListener("focusin", onFocusIn, true);
}

const REFUSED = {
  query: "Not from the query editor",
  none: "Focus an editor first",
};

/**
 * Sends `result` (from textOfEditor) to CyberChef, or toasts why not.
 * Returns whether it was sent.
 */
function send(result, toastStore, target = null) {
  if (result.refused) {
    toastStore.trigger({ message: REFUSED[result.refused], background: "variant-filled-warning" });
    return false;
  }
  openRecipe(target);
  chefInbox.update((list) => [...list, result.text]);
  goto("/cyberchef");
  return true;
}

// Opens recipe `target` for a send: a recipe id, "new" for a new recipe,
// or null to keep the open one.
function openRecipe(target) {
  if (target === "new") recipes.create();
  else if (target != null) recipes.open(target);
}

/**
 * Sends `text` as it is, as a menu that already has the text does, into
 * recipe `target` (a recipe id, "new", or null for the open recipe).
 */
export const sendTextToChef = (text, toastStore, target = null) => send({ text }, toastStore, target);

/** Sends from the last focused editor (global.send-to-cyberchef). */
export const sendFocusedToChef = (toastStore) => send(tracker.text(), toastStore);

/** Sends from the editor inside `pane`, as a pane's own Send button does. */
export const sendPaneToChef = (pane, toastStore) =>
  send(textOfEditor(pane?.querySelector(".cm-editor"), findView), toastStore);
