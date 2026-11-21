// Send to CyberChef (global.send-to-cyberchef): what a send takes, and the
// inputs on their way to the CyberChef page.
//
// The tracker remembers the last CodeMirror editor that had focus, so a
// send from the Marasi menu or a rail button, which take focus, still knows
// the editor. The Ledger query editor is never a source: a Marasi query is
// not data to decode.
import { get, writable } from "svelte/store";

/**
 * `findView(el)` gives the EditorView of a `.cm-editor` element
 * (EditorView.findFromDOM in the app).
 */
export function editorTracker(findView) {
  let last = null;
  return {
    /** Records a focus target; a target outside an editor changes nothing. */
    focused(target) {
      const el = target?.closest?.(".cm-editor");
      if (el) last = el;
    },
    /** { text } to send, or { refused: "query" | "none" }. */
    text() {
      return textOfEditor(last, findView);
    },
  };
}

/**
 * What a send takes from the `.cm-editor` element `el`: its selection, or
 * its whole content when nothing is selected. { text }, or
 * { refused: "query" | "none" }.
 */
export function textOfEditor(el, findView) {
  if (!el?.isConnected) return { refused: "none" };
  if (el.closest(".ledger-query")) return { refused: "query" };
  const view = findView(el);
  if (!view) return { refused: "none" };
  const { from, to, empty } = view.state.selection.main;
  return { text: empty ? view.state.doc.toString() : view.state.sliceDoc(from, to) };
}

/**
 * A pair's raw request or response as Insert puts it into CyberChef: with
 * LF line endings, as the Ledger shows it and Send to CyberChef takes it
 * from there (CodeMirror rewrites \r\n to \n), so the same pair is the
 * same input either way.
 */
export function pairText(raw) {
  return String(raw ?? "").replace(/\r\n/g, "\n");
}

// Texts sent and not yet put into CyberChef, oldest first. The CyberChef
// page takes them once its frame is ready.
export const chefInbox = writable([]);

/**
 * Puts each waiting text into CyberChef through `adapter.insertInput`, which
 * fills the open input tab when it is empty and adds a tab otherwise.
 */
export async function drainInbox(inbox, adapter) {
  for (;;) {
    const [next, ...rest] = get(inbox);
    if (next == null) return;
    inbox.set(rest);
    await adapter.insertInput(next);
  }
}
