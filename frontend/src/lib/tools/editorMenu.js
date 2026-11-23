// The editor selection menu: the Marasi menu a right-click on a code
// editor's selected text opens (EditorSelectionMenu.svelte), in the item
// shape of the Ledger's row menu (ledger/rowMenu.js), which RowMenu.svelte
// draws. Plain functions, so they load under node.
//
// Actions:
//   { type: "copy" }                    the selected text to the clipboard
//   { type: "send-to-chef", target }    the selected text into recipe
//                                       `target` (an id, or "new")
import { documentTargetItem } from "./documentTargets.js";

/**
 * The menu for a selection. `recipes` is the recipe collection's
 * { items, openId }; `chef` is whether the app offers CyberChef.
 */
export function editorMenuFor({ recipes = null, chef = true } = {}) {
  return [
    { id: "copy", label: "Copy", icon: "copy", action: { type: "copy" } },
    ...(chef
      ? [
          documentTargetItem({
            id: "chef",
            label: "Send to CyberChef",
            icon: "cooking-pot",
            noun: "recipe",
            documents: recipes,
            actionId: "global.send-to-cyberchef",
            action: { type: "send-to-chef" },
          }),
        ]
      : []),
  ];
}

/** What the menu's header says about `text`: its size and first line. */
export function selectionHeader(text) {
  const value = String(text ?? "");
  const lines = value.split("\n").length;
  const chars = value.length;
  const size = `${chars.toLocaleString()} ${chars === 1 ? "character" : "characters"}`;
  return {
    size: lines > 1 ? `${size} · ${lines.toLocaleString()} lines` : size,
    preview: value.trim().split("\n")[0].slice(0, 120),
  };
}

/**
 * The text a right-click on `target` acts on: the selection of the editor
 * (`.cm-editor`) it is in, or null when it is outside one, in the Ledger
 * query editor (a Marasi query isn't data to decode), or nothing is
 * selected. `findView(el)` gives an editor element's EditorView; an editor
 * that isn't editable leaves its selection to the page (`domSelection`).
 * Returns { editor, view, text }.
 */
export function selectionAt(target, findView, domSelection = null) {
  const editor = target?.closest?.(".cm-editor");
  if (!editor || editor.closest(".ledger-query")) return null;
  const view = findView(editor);
  const main = view?.state.selection.main;
  let text = main && !main.empty ? view.state.sliceDoc(main.from, main.to) : "";
  if (!text && domSelection && !domSelection.isCollapsed && editor.contains(domSelection.anchorNode)) {
    text = domSelection.toString();
  }
  return text ? { editor, view, text } : null;
}
