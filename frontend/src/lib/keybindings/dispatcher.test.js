import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";

function keydown(key, code, mods = {}, target = { tagName: "BODY" }) {
  const event = {
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.propagationStopped = true;
    },
    ...mods,
  };
  return event;
}

const home = { route: "/", modal: null, dialogOpen: false };
const cmd = (key, code, extra = {}) => keydown(key, code, { metaKey: true, ...extra });

function recorder() {
  const calls = [];
  return { calls, handler: (id) => () => calls.push(id) };
}

test("a global shortcut runs its action exactly once and consumes the key event", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("global.go-home", handler("go-home"));
  const event = cmd("1", "Digit1");
  assert.equal(dispatcher.dispatch(event, home), true);
  assert.deepEqual(calls, ["go-home"]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("only the current platform's bindings dispatch", () => {
  const mac = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const win = createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX });
  assert.equal(mac.resolve(keydown("1", "Digit1", { ctrlKey: true }), home), null);
  assert.equal(win.resolve(keydown("1", "Digit1", { ctrlKey: true }), home), "global.go-home");
  assert.equal(win.resolve(cmd("1", "Digit1"), home), null);
});

test("an Option-modified extension shortcut reaches its extension", () => {
  const catalog = buildCatalog({ extensions: [{ Name: "workshop" }, { Name: "fuzzer" }] });
  const dispatcher = createDispatcher({ catalog, platform: MACOS });
  assert.equal(
    dispatcher.resolve(cmd("™", "Digit2", { altKey: true }), home),
    "global.open-extension.fuzzer",
  );
});

test("the handler is looked up when the key is pressed, not when it was bound", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("global.jump-to-toast", handler("first"));
  const unregister = dispatcher.register("global.jump-to-toast", handler("second"));
  dispatcher.dispatch(cmd(".", "Period"), home);
  unregister();
  dispatcher.dispatch(cmd(".", "Period"), home);
  assert.deepEqual(calls, ["second", "first"]);
});

test("a bound action without a mounted handler leaves the key event alone", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const event = cmd("1", "Digit1");
  assert.equal(dispatcher.dispatch(event, home), false);
  assert.equal(event.defaultPrevented, false);
});

test("an unbound key runs nothing", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  assert.equal(dispatcher.resolve(cmd("j", "KeyJ"), home), null);
});

// Two overlapping contexts that bind the same key, to prove the dispatcher
// picks one winner by specificity rather than by registration order.
const contexts = [
  { id: "global", tier: "global", label: "Global", isEligible: () => true },
  { id: "ledger.drawer-open", tier: "drawer", label: "Ledger", isEligible: (s) => s.drawerOpen === true },
  { id: "ledger.drawer-closed", tier: "page", label: "Ledger", isEligible: (s) => s.route === "/ledger" && !s.drawerOpen },
];
const overlapping = createCatalog(
  [
    { id: "global.save", context: "global", label: "Global", defaults: { [MACOS]: ["meta+e"] } },
    { id: "ledger.drawer.edit", context: "ledger.drawer-open", label: "Drawer", defaults: { [MACOS]: ["meta+e"] } },
    { id: "ledger.edit", context: "ledger.drawer-closed", label: "Page", defaults: { [MACOS]: ["meta+e", "meta+p"] } },
  ],
  { contexts },
);

test("the most specific eligible context wins and only its action runs", () => {
  for (const order of [["global.save", "ledger.edit", "ledger.drawer.edit"], ["ledger.drawer.edit", "ledger.edit", "global.save"]]) {
    const dispatcher = createDispatcher({ catalog: overlapping, platform: MACOS });
    const { calls, handler } = recorder();
    for (const id of order) dispatcher.register(id, handler(id));
    dispatcher.dispatch(cmd("e", "KeyE"), { ...home, route: "/ledger" });
    dispatcher.dispatch(cmd("e", "KeyE"), { ...home, route: "/ledger", drawerOpen: true });
    dispatcher.dispatch(cmd("e", "KeyE"), { ...home, route: "/" });
    assert.deepEqual(calls, ["ledger.edit", "ledger.drawer.edit", "global.save"]);
  }
});

test("an action in an ineligible context never runs", () => {
  const dispatcher = createDispatcher({ catalog: overlapping, platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("ledger.edit", handler("ledger.edit"));
  assert.equal(dispatcher.dispatch(cmd("p", "KeyP"), { ...home, route: "/ledger", drawerOpen: true }), false);
  assert.deepEqual(calls, []);
});

test("a blocking modal suppresses menu shortcuts, but the WebSocket modal does not", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  assert.equal(dispatcher.resolve(cmd("1", "Digit1"), { ...home, modal: "Finding" }), null);
  assert.equal(dispatcher.resolve(cmd("k", "KeyK"), { ...home, modal: "Finding" }), null);
  assert.equal(
    dispatcher.resolve(cmd("1", "Digit1"), { ...home, modal: "WebsocketStream", dialogOpen: true }),
    "global.go-home",
  );
});

test("with the menu open, a shortcut closes the menu and runs its action, as with the menu closed", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("global.go-home", handler("go-home"));
  dispatcher.register("global.open-menu", handler("toggle-menu"));
  dispatcher.register("ledger.drawer-closed.toggle-settings", handler("toggle-query-fields"));
  const searchInput = { tagName: "INPUT", id: "commandmenu" };
  const menuOpen = { ...home, dialogOpen: true };
  let closed = 0;
  const closeMenu = () => (closed += 1);

  const home1 = cmd("1", "Digit1", { target: searchInput });
  assert.equal(dispatcher.dispatch(home1, menuOpen, { closeMenu }), true);
  assert.deepEqual([calls, closed, home1.defaultPrevented], [["go-home"], 1, true]);

  // A page's own shortcut, on its page.
  assert.equal(dispatcher.dispatch(cmd("p", "KeyP", { target: searchInput }), { ...menuOpen, route: "/ledger" }, { closeMenu }), true);
  assert.deepEqual([calls.at(-1), closed], ["toggle-query-fields", 2]);

  // The menu shortcut toggles the menu itself; nothing else closes it.
  assert.equal(dispatcher.dispatch(cmd("k", "KeyK", { target: searchInput }), menuOpen, { closeMenu }), true);
  assert.deepEqual([calls.at(-1), closed], ["toggle-menu", 2]);

  // A key no action takes is left to the menu, and typing to its search.
  const free = cmd("j", "KeyJ", { target: searchInput });
  assert.equal(dispatcher.dispatch(free, menuOpen, { closeMenu }), false);
  assert.equal(free.defaultPrevented, false);
  assert.equal(dispatcher.resolve(keydown("n", "KeyN", {}, searchInput), { ...menuOpen, route: "/logbook" }), null);
  assert.equal(closed, 2);
});

// The researcher added a bare O to the Ledger's Open (⌘⇧O by default).
test("with the menu open, an added bare key types into the search while the ⌘ key still runs the action", () => {
  const catalog = buildCatalog();
  const dispatcher = createDispatcher({ catalog, platform: MACOS });
  const knownActions = catalog.actions.map((a) => a.id).sort();
  dispatcher.configure({
    keybindings: {
      config: {
        version: 1,
        activeProfile: "work",
        profiles: [{
          id: "work",
          name: "Work",
          overrides: { [MACOS]: [{ action: "ledger.drawer-closed.open-request", keys: ["meta+shift+o", "o"] }], [WINDOWS_LINUX]: [] },
          knownActions,
        }],
      },
      problem: "",
    },
  });
  const { calls, handler } = recorder();
  dispatcher.register("ledger.drawer-closed.open-request", handler("open-request"));
  const ledger = { ...home, route: "/ledger" };
  const searchInput = { tagName: "INPUT", id: "commandmenu" };
  const menuOpen = { ...ledger, dialogOpen: true };

  assert.equal(dispatcher.resolve(keydown("o", "KeyO"), ledger), "ledger.drawer-closed.open-request");
  const typed = keydown("o", "KeyO", {}, searchInput);
  assert.equal(dispatcher.dispatch(typed, menuOpen, { closeMenu: () => calls.push("closed") }), false);
  assert.equal(typed.defaultPrevented, false);
  const chord = cmd("O", "KeyO", { shiftKey: true, target: searchInput });
  assert.equal(dispatcher.dispatch(chord, menuOpen, { closeMenu: () => calls.push("closed") }), true);
  assert.deepEqual(calls, ["closed", "open-request"]);
});

test("form fields block shortcuts except on Ledger, Logbook, Launchpad and Settings", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const input = { tagName: "INPUT" };
  const press = () => keydown("1", "Digit1", { metaKey: true }, input);
  assert.equal(dispatcher.resolve(press(), { ...home, route: "/armory" }), null);
  assert.equal(dispatcher.resolve(press(), { ...home, route: "/settings" }), "global.go-home");
  assert.equal(dispatcher.resolve(press(), { ...home, route: "/ledger" }), "global.go-home");
  assert.equal(dispatcher.resolve(press(), { ...home, route: "/logbook" }), "global.go-home");
});

test("running an action from the menu uses the live handler", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("global.go-ledger", handler("ledger"));
  assert.equal(dispatcher.run("global.go-ledger"), true);
  assert.equal(dispatcher.run("global.go-armory"), false);
  assert.deepEqual(calls, ["ledger"]);
});

test("reconfiguring the keymap changes dispatch and notifies subscribers", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const seen = [];
  const unsubscribe = dispatcher.subscribe((snapshot) => seen.push(snapshot.bindingsFor("global.go-home")));
  dispatcher.configure({ overrides: { [MACOS]: { "global.go-home": ["meta+h"] } } });
  unsubscribe();
  dispatcher.configure({ platform: WINDOWS_LINUX });
  assert.deepEqual(seen, [["meta+1"], ["meta+h"]]);
  assert.equal(dispatcher.resolve(keydown("h", "KeyH", { ctrlKey: true }), home), null);
  assert.equal(dispatcher.resolve(keydown("1", "Digit1", { ctrlKey: true }), home), "global.go-home");
});

// Keys pressed in a CodeMirror editor reach the editor first, as they did
// when shortcuts listened on document in the bubble phase: ⌘] indents the
// line, then Launchpad's Next Tab runs.
const codeMirror = {
  tagName: "DIV",
  isContentEditable: true,
  closest: (selector) => (selector.includes(".cm-editor") ? {} : null),
};
const launchpad = { ...home, route: "/launchpad" };

test("a key pressed in an editor is left to the editor, and its menu action runs after it", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("launchpad.next-tab", handler("next-tab"));
  const event = cmd("]", "BracketRight", { target: codeMirror });

  assert.equal(dispatcher.dispatch(event, launchpad), false);
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);

  assert.equal(dispatcher.dispatch(event, launchpad, { afterEditor: true }), true);
  assert.deepEqual(calls, ["next-tab"]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("a key pressed outside an editor runs its menu action once, before the page sees it", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const { calls, handler } = recorder();
  dispatcher.register("launchpad.next-tab", handler("next-tab"));
  const event = cmd("]", "BracketRight");
  assert.equal(dispatcher.dispatch(event, launchpad), true);
  assert.equal(dispatcher.dispatch(event, launchpad, { afterEditor: true }), false);
  assert.deepEqual(calls, ["next-tab"]);
});
