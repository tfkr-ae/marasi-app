// Keys a CodeMirror editor leaves to the app. basicSetup binds Mod-u to
// undoSelection and Mod-Shift-u (macOS) to redoSelection, but ⌘U is the
// app's Toggle Light Mode and ⌘⇧U Check for Updates: pressed in a focused
// editor, both ran, and undoSelection undid the last typing, so a draft held
// in a store (the Inject tabs') was emptied. These bindings claim the keys
// first and do nothing, so only the app's action runs: a key pressed in an
// editor still bubbles to the app's shortcut listener after the editor
// (keybindings/app.js).
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

const leaveToApp = () => true;

export const appKeys = Prec.highest(
  keymap.of([
    { key: "Mod-u", run: leaveToApp },
    { key: "Mod-Shift-u", run: leaveToApp },
  ]),
);
