// Send to CyberChef (global.send-to-cyberchef): what a send takes, and the
// inputs on their way to the CyberChef page.
//
// The tracker remembers the last CodeMirror editor that had focus, so a
// send from the Marasi menu or a rail button, which take focus, still knows
// the editor. The Ledger query editor is never a source: a Marasi query is
// not data to decode.
import { get, writable } from "svelte/store";
import { PART_NAMES, pairText, splitMessage } from "../../pairMessage.js";

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

// Texts sent and not yet put into CyberChef, oldest first. The CyberChef
// page takes them once its frame is ready. An entry is the text (Send to
// CyberChef from an editor), or { text, source } for a pair's request from
// Insert or a row or entry menu (pairInput), where `source` is
// { pairId, part, bodyOnly }.
export const chefInbox = writable([]);

/**
 * The inbox entry for pair `pairId`'s request `raw`, as Insert and the row
 * and entry menus put it in: the whole request, with its source.
 */
export function pairInput(pairId, raw) {
  return { text: pairText(raw), source: { pairId, part: "request", bodyOnly: false } };
}

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

/**
 * The From bar's swap of an input from `source`, whose text is now
 * `current`, to `want` ({ part, bodyOnly }), from the pair's raw messages
 * `details` (as Insert reads them). { text, source, ask }, where `ask` says
 * the researcher edited the input since it went in; or
 * { refused: "no response" } while the pair has none.
 */
export function swapInput(source, current, details, want) {
  // Insert's details are keyed by the parts' names: { Request, Response }.
  const raw = details?.[PART_NAMES[want.part]]?.Raw;
  if (!raw) return { refused: "no response" };
  const whole = pairText(raw);
  const text = want.bodyOnly ? splitMessage(whole).body : whole;
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
