import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { WRAP_LINE_LIMIT } from "./lineWrap.js";
import { foldedLongStrings, LONG_STRING_LIMIT, longRuns, longStrings, prepareUnfold, unfoldLongString, wrapSuspendedIn } from "./longStrings.js";

const headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n";
const base64 = "QUJD".repeat(625_000); // 2.5 MB
const base64File = `${headers}{"name":"file.pdf","data":"${base64}"}`;
// The editor reads "\r\n" as one line break, so its positions count "\n".
const dataStart = base64File.replaceAll("\r\n", "\n").indexOf(base64);

const editor = (doc, config) => EditorState.create({ doc, extensions: longStrings(config) });
const wraps = (state) =>
  state.facet(EditorView.contentAttributes).some((attrs) => String(attrs.class ?? "").split(" ").includes("cm-lineWrapping"));
const auto = { wrap: true, mode: "auto" };

test("a run of LONG_STRING_LIMIT characters without a space, quote, angle bracket, =, & or , is long", () => {
  assert.deepEqual(longRuns("a".repeat(LONG_STRING_LIMIT - 1)), []);
  assert.deepEqual(longRuns("a".repeat(LONG_STRING_LIMIT)), [{ from: 0, to: LONG_STRING_LIMIT }]);
  assert.deepEqual(longRuns(`"${"a".repeat(LONG_STRING_LIMIT)}" x`, 10), [{ from: 11, to: 11 + LONG_STRING_LIMIT }]);
  assert.deepEqual(longRuns(`{"a":"b","c":"d"}`.repeat(20_000)), [], "minified JSON of short strings");
  assert.deepEqual(longRuns(`<img src=${"a".repeat(LONG_STRING_LIMIT)}>`), [{ from: 9, to: 9 + LONG_STRING_LIMIT }]);
  assert.deepEqual(longRuns(`file=${"a".repeat(LONG_STRING_LIMIT)}==&x=1`), [{ from: 5, to: 5 + LONG_STRING_LIMIT }]);
  assert.deepEqual(longRuns(`data:image/png;base64,${"a".repeat(LONG_STRING_LIMIT)}`), [{ from: 22, to: 22 + LONG_STRING_LIMIT }]);
});

test("an editor folds a body's long strings and wraps the rest", () => {
  const state = editor(base64File, auto);
  assert.deepEqual(foldedLongStrings(state), [{ from: dataStart, to: dataStart + base64.length }]);
  assert.equal(state.doc.sliceString(dataStart, dataStart + base64.length), base64, "the text is unchanged, so a copy is complete");
  assert.equal(wraps(state), true);
  assert.equal(wrapSuspendedIn(state), false);
});

test("an unfolded string over the line limit stops wrapping under Auto, and wraps under Enabled", () => {
  const unfold = (state) => state.update({ effects: unfoldLongString.of(dataStart) }).state;

  const underAuto = unfold(editor(base64File, auto));
  assert.deepEqual(foldedLongStrings(underAuto), []);
  assert.equal(wraps(underAuto), false);
  assert.equal(wrapSuspendedIn(underAuto), true);

  const underEnabled = unfold(editor(base64File, { wrap: true, mode: "enabled" }));
  assert.equal(wraps(underEnabled), true);
  assert.equal(wrapSuspendedIn(underEnabled), false);
});

test("preparing to show a string stops wrapping first, keeping it folded until it shows", () => {
  const prepared = editor(base64File, auto).update({ effects: prepareUnfold.of(dataStart) }).state;
  assert.equal(foldedLongStrings(prepared).length, 1);
  assert.equal(wraps(prepared), false);
  const shown = prepared.update({ effects: unfoldLongString.of(dataStart) }).state;
  assert.deepEqual(foldedLongStrings(shown), []);
  assert.equal(wraps(shown), false);

  const short = `{"v":"${"a".repeat(LONG_STRING_LIMIT * 2)}"}`;
  assert.equal(wraps(editor(short, auto).update({ effects: prepareUnfold.of(6) }).state), true, "a string that leaves its line short keeps wrapping");
});

test("an unfolded string under the line limit still wraps", () => {
  const value = "a".repeat(LONG_STRING_LIMIT * 2);
  const state = editor(`{"v":"${value}"}`, auto);
  const open = state.update({ effects: unfoldLongString.of(6) }).state;
  assert.ok(value.length < WRAP_LINE_LIMIT);
  assert.equal(wraps(open), true);
  assert.equal(wrapSuspendedIn(open), false);
});

test("with Wrap lines off nothing wraps or is suspended, and long strings still fold", () => {
  const state = editor(base64File, { wrap: false, mode: "auto" });
  assert.equal(foldedLongStrings(state).length, 1);
  assert.equal(wraps(state), false);
  const open = state.update({ effects: unfoldLongString.of(dataStart) }).state;
  assert.equal(wrapSuspendedIn(open), false);
});

test("a long line with no long string is not wrapped under Auto", () => {
  const state = editor(`{"a":"b","c":"d"}`.repeat(10_000), auto);
  assert.deepEqual(foldedLongStrings(state), []);
  assert.equal(wraps(state), false);
  assert.equal(wrapSuspendedIn(state), true);
});

test("an edit keeps an unfolded string open, and a pasted long string folds", () => {
  let state = editor(base64File, auto).update({ effects: unfoldLongString.of(dataStart) }).state;
  state = state.update({ changes: { from: headers.length + 2, insert: "x" } }).state;
  assert.deepEqual(foldedLongStrings(state), [], "typing on the same line does not fold it again");

  const pasted = "Z".repeat(LONG_STRING_LIMIT);
  state = state.update({ changes: { from: 0, insert: `${pasted}\n` } }).state;
  assert.deepEqual(foldedLongStrings(state), [{ from: 0, to: LONG_STRING_LIMIT }]);
});

test("replacing the whole text folds its long strings afresh", () => {
  let state = editor(base64File, auto).update({ effects: unfoldLongString.of(dataStart) }).state;
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: base64File } }).state;
  assert.equal(foldedLongStrings(state).length, 1);
  assert.equal(wraps(state), true);
});

test("the Wrap lines toggle and the setting change through a reconfigure, keeping the folds", () => {
  let state = editor(base64File, auto).update({ effects: unfoldLongString.of(dataStart) }).state;
  assert.equal(wrapSuspendedIn(state), true);
  state = state.update({ effects: StateEffect.reconfigure.of(longStrings({ wrap: true, mode: "enabled" })) }).state;
  assert.deepEqual(foldedLongStrings(state), [], "the unfolded string stays open");
  assert.equal(wraps(state), true);
  state = state.update({ effects: StateEffect.reconfigure.of(longStrings({ wrap: false, mode: "enabled" })) }).state;
  assert.equal(wraps(state), false);
});
