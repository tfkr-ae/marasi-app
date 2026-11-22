import { test } from "node:test";
import assert from "node:assert/strict";
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { appKeys } from "./editorKeys.js";

// Presses `key` in an editor holding `state`, as CodeMirror's keymap does:
// each binding for it runs in precedence order until one handles the key.
function press(state, key) {
  const target = { state, dispatch: (tr) => (target.state = tr.state) };
  for (const binding of state.facet(keymap).flat()) {
    if (binding.key === key && binding.run?.(target)) break;
  }
  return target.state;
}

function typed(extensions, text) {
  const state = EditorState.create({ extensions });
  return state.update({ changes: { from: 0, insert: text }, userEvent: "input.type" }).state;
}

test("the editor's own Mod-u undoes typing, which is how ⌘U lost the Inject draft", () => {
  assert.equal(press(typed([basicSetup], "draft"), "Mod-u").doc.toString(), "");
});

test("⌘U, the app's Toggle Light Mode, leaves the typed text in the editor", () => {
  assert.equal(press(typed([basicSetup, appKeys], "draft"), "Mod-u").doc.toString(), "draft");
});
