// Folds long strings in a code editor, and wraps lines from what is left
// showing. A run of LONG_STRING_LIMIT characters without a space, quote or
// angle bracket (a base64 file in a JSON response, a data: URL) shows as a
// "… 2.4 MB · show" placeholder; clicking it shows the string. The text is
// unchanged, so selecting across a placeholder copies the whole string.
// "=", "&" and "," also end a run, so a form field's or a data: URL's value
// folds without its name; base64 has none of them but its closing "=".
//
// Wrapping follows the Wrap lines toggle and the Line wrapping setting (see
// lineWrap.js), counting only what shows: a folded string leaves its line
// short enough to wrap, and once it is shown a line over WRAP_LINE_LIMIT is
// not wrapped under "auto", as wrapping it freezes the page.
import { Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { WRAP_LINE_LIMIT } from "./lineWrap.js";
import { formatSize } from "./ledger/table.js";

/** Runs at least this long are folded. */
export const LONG_STRING_LIMIT = 10_000;

const LONG_RUN = new RegExp(`[^\\s"'<>=&,]{${LONG_STRING_LIMIT},}`, "g");

/** The long runs in `text`, as { from, to } positions offset by `offset`. */
export function longRuns(text, offset = 0) {
  return Array.from(text.matchAll(LONG_RUN), (match) => ({
    from: offset + match.index,
    to: offset + match.index + match[0].length,
  }));
}

/** Shows the folded string that starts at the given position. */
export const unfoldLongString = StateEffect.define({ map: (pos, changes) => changes.mapPos(pos) });

/**
 * Settles the wrapping as it will be once the folded string at the given
 * position shows, keeping it folded. A click sends this a frame before
 * unfoldLongString: shown into a wrapped line, a long string is laid out
 * wrapped once (half a second for 2.5 MB) before the wrapping turns off.
 */
export const prepareUnfold = StateEffect.define({ map: (pos, changes) => changes.mapPos(pos) });

// { wrap, mode, onSuspend }: the Wrap lines toggle, the Line wrapping
// setting, and a callback told whether wrapping is suspended.
const wrapConfig = Facet.define({
  combine: (values) => values[values.length - 1] ?? { wrap: false, mode: "auto" },
});

class LongStringWidget extends WidgetType {
  constructor(length) {
    super();
    this.length = length;
  }
  eq(other) {
    return other.length === this.length;
  }
  toDOM(view) {
    const placeholder = document.createElement("span");
    placeholder.className = "cm-long-string";
    placeholder.textContent = `… ${formatSize(this.length)} · show`;
    placeholder.title = `${this.length.toLocaleString()} characters folded. Click to show them.`;
    placeholder.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = view.posAtDOM(placeholder);
      view.dispatch({ effects: prepareUnfold.of(pos) });
      requestAnimationFrame(() => {
        if (view.dom.isConnected) view.dispatch({ effects: unfoldLongString.of(pos) });
      });
    });
    return placeholder;
  }
}

const fold = (run) => Decoration.replace({ widget: new LongStringWidget(run.to - run.from) }).range(run.from, run.to);

// Whether a line is longer than WRAP_LINE_LIMIT once its folds are hidden.
function hasLongShowingLine(doc, folds) {
  let pos = 0;
  for (const line of doc.iterLines()) {
    const from = pos;
    pos += line.length + 1;
    if (line.length <= WRAP_LINE_LIMIT) continue;
    let showing = line.length;
    folds.between(from, from + line.length, (foldFrom, foldTo) => {
      showing -= foldTo - foldFrom;
    });
    if (showing > WRAP_LINE_LIMIT) return true;
  }
  return false;
}

function folded(doc, folds, open) {
  return { folds, open, longLine: hasLongShowingLine(doc, folds) };
}

const overlaps = (ranges, from, to) => ranges.some((range) => range.from < to && range.to > from);

// { folds, open, longLine }: the folded strings, the shown ones (kept shown
// through edits), and whether a showing line is over WRAP_LINE_LIMIT.
const longStringField = StateField.define({
  create(state) {
    return folded(state.doc, Decoration.set(longRuns(state.doc.toString()).map(fold)), []);
  },
  update(value, tr) {
    let { folds, open } = value;
    let changed = false;
    if (tr.docChanged) {
      changed = true;
      let replacedAll = false;
      tr.changes.iterChanges((fromA, toA) => {
        if (fromA === 0 && toA === tr.startState.doc.length) replacedAll = true;
      });
      if (replacedAll) return longStringField.create(tr.state);
      folds = folds.map(tr.changes);
      open = open
        .map((range) => ({ from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1) }))
        .filter((range) => range.to > range.from);
      // Look for new long strings on the lines the edit touched.
      const added = [];
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        const from = tr.state.doc.lineAt(fromB).from;
        const to = tr.state.doc.lineAt(toB).to;
        for (const run of longRuns(tr.state.doc.sliceString(from, to), from)) {
          let taken = overlaps(open, run.from, run.to) || overlaps(added, run.from, run.to);
          folds.between(run.from, run.to, () => {
            taken = true;
          });
          if (!taken) added.push(run);
        }
      });
      if (added.length) folds = folds.update({ add: added.map(fold), sort: true });
    }
    for (const effect of tr.effects) {
      if (!effect.is(unfoldLongString)) continue;
      folds.between(effect.value, effect.value, (from, to) => {
        open = [...open, { from, to }];
      });
      folds = folds.update({ filter: (from, to) => !(from <= effect.value && effect.value <= to) });
      changed = true;
    }
    let next = changed ? folded(tr.state.doc, folds, open) : value;
    for (const effect of tr.effects) {
      if (!effect.is(prepareUnfold) || next.longLine) continue;
      const rest = folds.update({ filter: (from, to) => !(from <= effect.value && effect.value <= to) });
      if (hasLongShowingLine(tr.state.doc, rest)) next = { ...next, longLine: true };
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.folds),
    EditorView.atomicRanges.of((view) => view.state.field(field).folds),
  ],
});

/** The folded strings, as { from, to } positions. */
export function foldedLongStrings(state) {
  const ranges = [];
  state.field(longStringField).folds.between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
}

/** Whether Wrap lines is on but a showing line is too long to wrap under the setting. */
export function wrapSuspendedIn(state) {
  const { wrap, mode } = state.facet(wrapConfig);
  return Boolean(wrap) && mode !== "enabled" && state.field(longStringField).longLine;
}

// The editor's wrapping: what EditorView.lineWrapping adds, when it applies.
const wrapping = EditorView.contentAttributes.compute([wrapConfig, longStringField], (state) => {
  const { wrap, mode } = state.facet(wrapConfig);
  const wraps = Boolean(wrap) && (mode === "enabled" || !state.field(longStringField).longLine);
  return wraps ? { class: "cm-lineWrapping" } : {};
});

// Tells onSuspend whether wrapping is suspended, when the editor opens on a
// text and whenever that changes.
const suspendReport = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.suspended = null;
      this.report(view.state);
    }
    update(update) {
      this.report(update.state);
    }
    report(state) {
      const suspended = wrapSuspendedIn(state);
      if (suspended === this.suspended) return;
      this.suspended = suspended;
      state.facet(wrapConfig).onSuspend?.(suspended);
    }
  },
);

const theme = EditorView.baseTheme({
  ".cm-long-string": {
    cursor: "pointer",
    padding: "0 4px",
    margin: "0 1px",
    borderRadius: "3px",
    backgroundColor: "rgba(127, 127, 127, 0.18)",
    opacity: "0.8",
  },
  ".cm-long-string:hover": { opacity: "1" },
});

/**
 * Folds long strings and wraps lines. Use it instead of the editor's own
 * lineWrapping. `wrap` is the Wrap lines toggle, `mode` the Line wrapping
 * setting, and `onSuspend(suspended)` hears whether a long showing line
 * stopped wrapping.
 */
export function longStrings({ wrap, mode, onSuspend } = {}) {
  return [wrapConfig.of({ wrap, mode, onSuspend }), longStringField, wrapping, suspendReport, theme];
}
