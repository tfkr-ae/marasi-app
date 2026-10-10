import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { reservedBindingProblem } from "./gate.js";
import { MACOS } from "./platform.js";

// Typing suppression, observed through the dispatcher: an unmodified
// (Vim-style) binding must never fire while the researcher is typing.

function keydown(key, code, { target = element("BODY"), ...mods } = {}) {
  return {
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target,
    preventDefault() {},
    stopImmediatePropagation() {},
    ...mods,
  };
}

// A minimal DOM element: tag name, optional id, contenteditable, and the
// ancestors `closest` can find (by class name).
function element(tagName, { id = "", isContentEditable = false, insideClasses = [] } = {}) {
  return {
    tagName,
    id,
    isContentEditable,
    closest: (selector) => (insideClasses.some((name) => selector.includes(`.${name}`)) ? {} : null),
  };
}

const home = { route: "/", modal: null, dialogOpen: false };

const vimLike = createCatalog([
  { id: "global.next-page", context: "global", label: "Next page", defaults: { [MACOS]: ["j"] } },
  { id: "global.previous-page", context: "global", label: "Previous page", defaults: { [MACOS]: ["shift+k"] } },
  { id: "global.save", context: "global", label: "Save", defaults: { [MACOS]: ["meta+s"] } },
]);

const editableTargets = {
  input: element("INPUT"),
  textarea: element("TEXTAREA"),
  select: element("SELECT"),
  contenteditable: element("DIV", { isContentEditable: true }),
  "CodeMirror (vim mode, focus on the editor wrapper)": element("DIV", { insideClasses: ["cm-editor"] }),
  "Marasi menu search field": element("INPUT", { id: "commandmenu" }),
};

test("an unmodified binding runs from a non-editable target", () => {
  const dispatcher = createDispatcher({ catalog: vimLike, platform: MACOS });
  assert.equal(dispatcher.resolve(keydown("j", "KeyJ"), home), "global.next-page");
  assert.equal(dispatcher.resolve(keydown("K", "KeyK", { shiftKey: true }), home), "global.previous-page");
});

test("an unmodified binding never runs while typing, even where modified shortcuts work in fields", () => {
  const dispatcher = createDispatcher({ catalog: vimLike, platform: MACOS });
  for (const route of ["/", "/ledger", "/logbook"]) {
    for (const [name, target] of Object.entries(editableTargets)) {
      const state = { ...home, route };
      assert.equal(dispatcher.resolve(keydown("j", "KeyJ", { target }), state), null, `${name} on ${route}`);
      assert.equal(
        dispatcher.resolve(keydown("K", "KeyK", { target, shiftKey: true }), state),
        null,
        `shift is not a modifier: ${name} on ${route}`,
      );
    }
  }
});

test("no binding runs during IME composition", () => {
  const dispatcher = createDispatcher({ catalog: vimLike, platform: MACOS });
  const composing = [
    keydown("j", "KeyJ", { isComposing: true }),
    keydown("Process", "KeyJ"),
    keydown("j", "KeyJ", { keyCode: 229 }),
    keydown("s", "KeyS", { metaKey: true, isComposing: true }),
  ];
  for (const event of composing) assert.equal(dispatcher.resolve(event, home), null);
});

const codeMirror = element("DIV", { isContentEditable: true, insideClasses: ["cm-editor"] });

test("modified shortcuts keep working in editors, and in fields where they work today", () => {
  const dispatcher = createDispatcher({ catalog: vimLike, platform: MACOS });
  const save = (target) => keydown("s", "KeyS", { metaKey: true, target });
  for (const route of ["/", "/ledger", "/armory"]) {
    assert.equal(dispatcher.resolve(save(codeMirror), { ...home, route }), "global.save", route);
  }
  assert.equal(dispatcher.resolve(save(element("INPUT")), { ...home, route: "/ledger" }), "global.save");
  assert.equal(dispatcher.resolve(save(element("TEXTAREA")), { ...home, route: "/logbook" }), "global.save");
  assert.equal(dispatcher.resolve(save(element("INPUT")), { ...home, route: "/armory" }), null);
});

test("Escape, Tab and plain Enter never run a menu action, so dialogs and the Ledger query keep them", () => {
  const claimed = createCatalog([
    { id: "global.escape", context: "global", label: "Escape", defaults: { [MACOS]: ["escape", "shift+escape"] } },
    { id: "global.tab", context: "global", label: "Tab", defaults: { [MACOS]: ["tab", "shift+tab"] } },
    { id: "global.enter", context: "global", label: "Enter", defaults: { [MACOS]: ["enter", "shift+enter"] } },
    { id: "global.run", context: "global", label: "Run", defaults: { [MACOS]: ["meta+shift+enter"] } },
  ]);
  const dispatcher = createDispatcher({ catalog: claimed, platform: MACOS });
  const queryBox = element("INPUT", { id: "searchBox" });
  const ledger = { ...home, route: "/ledger" };
  for (const target of [element("BODY"), element("BUTTON"), queryBox]) {
    for (const [key, code] of [["Escape", "Escape"], ["Tab", "Tab"], ["Enter", "Enter"]]) {
      assert.equal(dispatcher.resolve(keydown(key, code, { target }), ledger), null, `${key} on ${target.tagName}`);
      assert.equal(dispatcher.resolve(keydown(key, code, { target, shiftKey: true }), ledger), null, `shift+${key}`);
    }
  }
  const run = keydown("Enter", "Enter", { target: queryBox, metaKey: true, shiftKey: true });
  assert.equal(dispatcher.resolve(run, ledger), "global.run");
});

test("no binding runs while a shortcut is being recorded", () => {
  const dispatcher = createDispatcher({ catalog: vimLike, platform: MACOS });
  const capturing = { ...home, capturing: true };
  assert.equal(dispatcher.resolve(keydown("s", "KeyS", { metaKey: true }), capturing), null);
  assert.equal(dispatcher.resolve(keydown("j", "KeyJ"), capturing), null);
});

test("factory shortcuts still fire from the Ledger query box and from CodeMirror", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const goHome = (target) => keydown("1", "Digit1", { metaKey: true, target });
  const queryBox = element("INPUT", { id: "searchBox" });
  assert.equal(dispatcher.resolve(goHome(queryBox), { ...home, route: "/ledger" }), "global.go-home");
  assert.equal(dispatcher.resolve(goHome(codeMirror), { ...home, route: "/armory" }), "global.go-home");
});

test("a reserved binding's problem names its keys the way the keyboard does", () => {
  assert.equal(reservedBindingProblem("tab"), "Tab is reserved for dialogs and focus");
  assert.equal(reservedBindingProblem("shift+enter"), "Shift+Enter is reserved for dialogs and focus");
  assert.equal(reservedBindingProblem("escape"), "Escape is reserved for dialogs and focus");
});
