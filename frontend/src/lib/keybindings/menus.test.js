import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";

// Page and drawer menus resolved through the app's real catalog and menu
// contexts, against the layout's dispatcher state shape.

function keydown(key, code, mods = {}, target = { tagName: "BODY" }) {
  return {
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target,
    preventDefault() {},
    stopImmediatePropagation() {},
    ...mods,
  };
}

const cmd = (key, code) => keydown(key, code, { metaKey: true });
const cmdShift = (key, code) => keydown(key, code, { metaKey: true, shiftKey: true });

function on(route, drawer = { open: false }) {
  return { route, modal: null, dialogOpen: false, drawer };
}

const requestDrawer = (meta = {}) => ({ open: true, id: "request-response", meta });
const websocketUpgrade = { metadata: { protocol: "websocket" } };

const mac = () => createDispatcher({ catalog: buildCatalog(), platform: MACOS });

test("⌘⇧F filters the Ledger with its drawer closed and creates a finding with it open", () => {
  const dispatcher = mac();
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), on("/ledger")), "ledger.drawer-closed.focus-exclusion");
  assert.equal(
    dispatcher.resolve(cmdShift("F", "KeyF"), on("/ledger", requestDrawer())),
    "ledger.drawer-open.create-finding",
  );
});

test("opening the Ledger drawer replaces the page's actions; closing it restores them", () => {
  const dispatcher = mac();
  const calls = [];
  for (const id of ["ledger.drawer-closed.toggle-settings", "ledger.drawer-closed.next-page"]) {
    dispatcher.register(id, () => calls.push(id));
  }
  assert.equal(dispatcher.dispatch(cmd("p", "KeyP"), on("/ledger", requestDrawer())), false);
  assert.equal(dispatcher.dispatch(cmd("]", "BracketRight"), on("/ledger", requestDrawer())), false);
  assert.deepEqual(calls, []);
  assert.equal(dispatcher.dispatch(cmd("p", "KeyP"), on("/ledger")), true);
  assert.deepEqual(calls, ["ledger.drawer-closed.toggle-settings"]);
});

test("⌘⇧O opens the WebSocket stream only from an upgrade request's drawer", () => {
  const dispatcher = mac();
  const press = () => cmdShift("O", "KeyO");
  assert.equal(dispatcher.resolve(press(), on("/ledger")), "ledger.drawer-closed.open-request");
  assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer())), null);
  assert.equal(
    dispatcher.resolve(press(), on("/ledger", requestDrawer(websocketUpgrade))),
    "ledger.drawer-open.websocket.open-stream",
  );
  assert.equal(
    dispatcher.resolve(press(), on("/ledger", requestDrawer({ incomingResponse: { StatusCode: 101 } }))),
    "ledger.drawer-open.websocket.open-stream",
  );
});

test("⌘⇧] steps Armory runs on the page and the run's requests in its request drawer", () => {
  const dispatcher = mac();
  const press = () => cmdShift("]", "BracketRight");
  assert.equal(dispatcher.resolve(press(), on("/armory")), "armory.page.next-run");
  assert.equal(dispatcher.resolve(press(), on("/armory", requestDrawer())), "armory.drawer.next-request");
  assert.equal(dispatcher.resolve(cmd("p", "KeyP"), on("/armory", requestDrawer())), null);
  // Only the request drawer replaces the Armory menu.
  assert.equal(
    dispatcher.resolve(press(), on("/armory", { open: true, id: "extension-logs" })),
    "armory.page.next-run",
  );
});

test("each page's shared shortcuts run that page's action", () => {
  const dispatcher = mac();
  const expected = [
    ["/launchpad", "launchpad.toggle-settings", "launchpad.launch"],
    ["/checkpoint", "checkpoint.toggle-settings", "checkpoint.show-logs"],
    ["/logbook", "logbook.toggle-settings", null],
    ["/compass", "compass.toggle-settings", "compass.show-logs"],
    ["/workshop", "workshop.toggle-settings", "workshop.show-logs"],
  ];
  for (const [route, settings, shiftL] of expected) {
    assert.equal(dispatcher.resolve(cmd("p", "KeyP"), on(route)), settings, route);
    assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on(route)), shiftL, route);
  }
});

test("a logs or report drawer keeps its page's menu", () => {
  const dispatcher = mac();
  const logs = { open: true, id: "extension-logs", meta: { extensionName: "checkpoint" } };
  assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on("/checkpoint", logs)), "checkpoint.show-logs");
  assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on("/compass", logs)), "compass.show-logs");
  assert.equal(
    dispatcher.resolve(cmdShift("E", "KeyE"), on("/logbook", { open: true, id: "report-export" })),
    "logbook.export-report",
  );
});

test("global actions stay available on pages and in drawers", () => {
  const dispatcher = mac();
  for (const state of [on("/ledger"), on("/ledger", requestDrawer()), on("/armory", requestDrawer()), on("/workshop")]) {
    assert.equal(dispatcher.resolve(cmd("1", "Digit1"), state), "global.go-home", state.route);
  }
});

test("Windows/Linux page shortcuts use Ctrl", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX });
  const ctrlShift = (key, code) => keydown(key, code, { ctrlKey: true, shiftKey: true });
  assert.equal(dispatcher.resolve(ctrlShift("F", "KeyF"), on("/ledger")), "ledger.drawer-closed.focus-exclusion");
  assert.equal(dispatcher.resolve(ctrlShift("F", "KeyF"), on("/ledger", requestDrawer())), "ledger.drawer-open.create-finding");
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), on("/ledger")), null);
});

test("no menu context binds one key to two of its actions", () => {
  const catalog = buildCatalog();
  for (const platform of [MACOS, WINDOWS_LINUX]) {
    for (const context of catalog.contexts) {
      const seen = new Map();
      for (const action of catalog.inContext(context.id)) {
        for (const binding of action.defaults[platform]) {
          assert.equal(seen.get(binding), undefined, `${context.id} ${platform} ${binding}: ${action.id}`);
          seen.set(binding, action.id);
        }
      }
    }
  }
});

test("an eligible overlay beats a drawer, which beats a page, which beats global", () => {
  const contexts = [
    { id: "global", tier: "global", label: "Global", isEligible: () => true },
    { id: "page", tier: "page", label: "Page", isEligible: (s) => s.route === "/page" },
    { id: "page.drawer", tier: "drawer", label: "Drawer", isEligible: (s) => Boolean(s.drawer?.open) },
    { id: "page.overlay", tier: "overlay", label: "Overlay", isEligible: (s) => s.modal === "WebsocketStream" },
  ];
  const catalog = createCatalog(
    ["global", "page", "page.drawer", "page.overlay"].map((context) => ({
      id: `${context}.act`,
      context,
      label: context,
      defaults: { [MACOS]: ["meta+e"] },
    })),
    { contexts },
  );
  const dispatcher = createDispatcher({ catalog, platform: MACOS });
  const resolve = (state) => dispatcher.resolve(cmd("e", "KeyE"), { ...on("/page"), ...state });
  assert.equal(resolve({ modal: "WebsocketStream", drawer: { open: true } }), "page.overlay.act");
  assert.equal(resolve({ drawer: { open: true } }), "page.drawer.act");
  assert.equal(resolve({}), "page.act");
  assert.equal(resolve({ route: "/" }), "global.act");
});

test("page actions never run on another page", () => {
  const dispatcher = mac();
  const calls = [];
  dispatcher.register("ledger.drawer-closed.toggle-settings", () => calls.push("ledger"));
  assert.equal(dispatcher.dispatch(cmd("p", "KeyP"), on("/")), false);
  assert.equal(dispatcher.dispatch(cmd("p", "KeyP"), on("/settings")), false);
  assert.deepEqual(calls, []);
});
