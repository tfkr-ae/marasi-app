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
// page takes them once its frame is ready. An entry is the text (Send to
// CyberChef), or { text, source } for a pair's text from Insert, where
// `source` is { pairId, part, bodyOnly }.
export const chefInbox = writable([]);

/**
 * Puts each waiting text into CyberChef through `adapter.insertInput`, which
 * fills the open input tab when it is empty and adds a tab otherwise. An
 * entry with a source is recorded with `onSource(tab, source)` for the tab
 * it landed in, the source's `inserted` being the text put in.
 */
export async function drainInbox(inbox, adapter, onSource = () => {}) {
  for (;;) {
    const [next, ...rest] = get(inbox);
    if (next == null) return;
    inbox.set(rest);
    const text = typeof next === "string" ? next : next.text;
    await adapter.insertInput(text);
    if (next.source) onSource(adapter.openTab(), { ...next.source, inserted: text });
  }
}

// An input's source: the pair its text came from by Insert,
// { pairId, part: "request" | "response", bodyOnly, inserted }, `inserted`
// being the text as it was put in. A Recipe keeps its sources as
// `sources`, a list parallel to `inputs` (null for an input with none).
// While CyberChef shows the recipe they are keyed by input tab number,
// since a removed tab leaves a gap in CyberChef's numbers.

/** The sources of a recipe just loaded into the tabs `nums`, by tab number. */
export function sourcesByTab(nums, sources) {
  const byTab = new Map();
  nums.forEach((num, i) => {
    if (sources?.[i]) byTab.set(num, sources[i]);
  });
  return byTab;
}

const MESSAGE = { request: "Request", response: "Response" };

/**
 * The From bar's swap of an input from `source`, whose text is now
 * `current`, to `want` ({ part, bodyOnly }), from the pair's raw messages
 * `details` (as Insert reads them). { text, source, ask }, where `ask` says
 * the researcher edited the input since it went in; or
 * { refused: "no response" } while the pair has none.
 */
export function swapInput(source, current, details, want) {
  const raw = details?.[MESSAGE[want.part]]?.Raw;
  if (!raw) return { refused: "no response" };
  const whole = pairText(raw);
  const gap = whole.indexOf("\n\n");
  const text = !want.bodyOnly ? whole : gap === -1 ? "" : whole.slice(gap + 2);
  return {
    text,
    source: { pairId: source.pairId, part: want.part, bodyOnly: Boolean(want.bodyOnly), inserted: text },
    ask: current !== source.inserted,
  };
}

/** The recipe's `sources` for the tabs `nums`, in tab order. */
export function sourcesOfTabs(nums, byTab) {
  return nums.map((num) => byTab.get(num) ?? null);
}
