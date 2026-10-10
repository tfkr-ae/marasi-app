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

test("while the menu is open only the menu shortcut runs, so it can close the menu", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const paletteOpen = { ...home, dialogOpen: true };
  const searchInput = { tagName: "INPUT", id: "commandmenu" };
  assert.equal(dispatcher.resolve(cmd("1", "Digit1"), paletteOpen), null);
  assert.equal(dispatcher.resolve(keydown("k", "KeyK", { metaKey: true }, searchInput), paletteOpen), "global.open-menu");
});

test("form fields block shortcuts except on Ledger and Logbook", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const input = { tagName: "INPUT" };
  const press = () => keydown("1", "Digit1", { metaKey: true }, input);
  assert.equal(dispatcher.resolve(press(), { ...home, route: "/settings" }), null);
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
