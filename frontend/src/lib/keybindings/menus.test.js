import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { CONTEXTS, contextsConflict } from "./contexts.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import { factoryKeybindings, validateKeybindings } from "./profiles.js";

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

test("each WebSocket tab overlaps the modal's shared context but not the other tabs", () => {
  const conflict = (a, b) => contextsConflict(CONTEXTS, a, b);
  for (const tab of ["websocket.stream", "websocket.checkpoint", "websocket.inject"]) {
    assert.ok(conflict(tab, "websocket"), tab);
    assert.ok(conflict("websocket", tab), tab);
  }
  assert.ok(!conflict("websocket.stream", "websocket.inject"));
  assert.ok(!conflict("websocket.checkpoint", "websocket.inject"));
});

test("the factory profile is valid with WebSocket and extension actions in the catalog", () => {
  const catalog = buildCatalog({
    extensions: [{ Name: "workshop" }, { Name: "Port Scanner" }],
    extensionMenus: {
      "Port Scanner": [
        { name: "Scan", action: "scan", keys: ["⌘+⇧+H", "ctrl+⇧+H"] },
        { name: "Settings clash", action: "settings", keys: ["⌘+P", "ctrl+P"] },
        { name: "Menu clash", action: "menu", keys: ["⌘+K", "ctrl+K"] },
        { name: "Scan again", action: "scan-again", keys: ["⌘+⇧+H", "ctrl+⇧+H"] },
        { name: "Reserved", action: "reserved", keys: ["shift+enter", "escape"] },
      ],
    },
  });
  assert.deepEqual(validateKeybindings(catalog, factoryKeybindings()), []);
  assert.deepEqual(catalog.get("extension.port-scanner.scan").defaults[MACOS], ["meta+shift+h"]);
  assert.deepEqual(catalog.get("extension.port-scanner.scan-again").defaults[MACOS], []);
});

const websocketModal = (websocketTab, drawer = requestDrawer(websocketUpgrade)) => ({
  ...on("/ledger", drawer),
  modal: "WebsocketStream",
  websocketTab,
});

test("the WebSocket modal's shared and per-tab shortcuts run the open tab's action", () => {
  const dispatcher = mac();
  const expected = [
    ["stream", cmdShift("D", "KeyD"), null],
    ["checkpoint", cmdShift("D", "KeyD"), "websocket.checkpoint.drop-frame"],
    ["inject", cmdShift("D", "KeyD"), "websocket.inject.toggle-direction"],
    ["stream", cmdShift("I", "KeyI"), "websocket.stream.copy-frame-to-inject"],
    ["checkpoint", cmdShift("I", "KeyI"), "websocket.checkpoint.toggle-intercept"],
    ["stream", cmdShift("Enter", "Enter"), null],
    ["inject", cmdShift("Enter", "Enter"), "websocket.inject.inject-frame"],
    ["inject", cmdShift("O", "KeyO"), "websocket.inject.cycle-opcode"],
    ["stream", cmdShift("{", "BracketLeft"), "websocket.stream.previous-frame"],
    ["stream", cmdShift("}", "BracketRight"), "websocket.stream.next-frame"],
    ["stream", cmdShift("M", "KeyM"), "websocket.stream.toggle-frame-metadata"],
    ["stream", cmdShift("ArrowDown", "ArrowDown"), "websocket.stream.jump-to-bottom"],
  ];
  for (const [tab, event, actionId] of expected) {
    assert.equal(dispatcher.resolve(event, websocketModal(tab)), actionId, `${tab} ${event.key}`);
  }
  for (const tab of ["stream", "checkpoint", "inject"]) {
    assert.equal(dispatcher.resolve(cmd("[", "BracketLeft"), websocketModal(tab)), "websocket.previous-tab");
    assert.equal(dispatcher.resolve(cmd("]", "BracketRight"), websocketModal(tab)), "websocket.next-tab");
    assert.equal(dispatcher.resolve(cmdShift("X", "KeyX"), websocketModal(tab)), "websocket.close-connection");
  }
});

test("the WebSocket modal keeps global actions but not the drawer or page beneath it", () => {
  const dispatcher = mac();
  for (const drawer of [requestDrawer(websocketUpgrade), requestDrawer()]) {
    const state = websocketModal("stream", drawer);
    assert.equal(dispatcher.resolve(cmd("1", "Digit1"), state), "global.go-home");
    assert.equal(dispatcher.resolve(cmd("k", "KeyK"), state), "global.open-menu");
    // Ledger drawer shortcuts with no WebSocket counterpart stay inert.
    assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), state), null);
    assert.equal(dispatcher.resolve(cmdShift("]", "BracketRight"), state), "websocket.stream.next-frame");
    assert.equal(dispatcher.resolve(cmdShift("O", "KeyO"), state), null);
  }
  // Armory's request drawer opens the modal too.
  const armory = { ...websocketModal("checkpoint"), route: "/armory" };
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), armory), "websocket.checkpoint.forward-frame");
  assert.equal(dispatcher.resolve(cmdShift("[", "BracketLeft"), armory), null);
});

test("a modal closes on its opening action's binding for the current platform", () => {
  const dispatcher = mac();
  const finding = { ...on("/ledger", requestDrawer()), modal: "Finding" };
  const toggle = "ledger.drawer-open.create-finding";
  assert.equal(dispatcher.isModalToggle(cmdShift("F", "KeyF"), toggle, finding), true);
  assert.equal(dispatcher.isModalToggle(cmd("f", "KeyF"), toggle, finding), false);
  assert.equal(
    dispatcher.isModalToggle(keydown("F", "KeyF", { ctrlKey: true, shiftKey: true }), toggle, finding),
    false,
  );
  // The toggle follows the binding, wherever the modal was opened from.
  dispatcher.configure({ overrides: { [MACOS]: { [toggle]: ["meta+alt+f"] } } });
  const armory = { ...finding, route: "/armory" };
  assert.equal(dispatcher.isModalToggle(keydown("ƒ", "KeyF", { metaKey: true, altKey: true }), toggle, armory), true);
  assert.equal(dispatcher.isModalToggle(cmdShift("F", "KeyF"), toggle, armory), false);
});

test("the WebSocket modal closes on ⌘⇧O except where its open tab binds the key", () => {
  const dispatcher = mac();
  dispatcher.register("websocket.inject.cycle-opcode", () => {});
  const toggle = "ledger.drawer-open.websocket.open-stream";
  const press = () => cmdShift("O", "KeyO");
  assert.equal(dispatcher.isModalToggle(press(), toggle, websocketModal("stream")), true);
  assert.equal(dispatcher.isModalToggle(press(), toggle, websocketModal("checkpoint")), true);
  assert.equal(dispatcher.isModalToggle(press(), toggle, websocketModal("inject")), false);
});

test("an extension's menu actions run only on that extension's page", () => {
  const dispatcher = createDispatcher({
    catalog: buildCatalog({
      extensions: [{ Name: "Port Scanner" }, { Name: "notes" }],
      extensionMenus: {
        "Port Scanner": [{ name: "Scan", action: "scan", keys: ["⌘+⇧+H", "ctrl+⇧+H"] }],
        notes: [{ name: "Jot", action: "jot", keys: ["⌘+⇧+H", "ctrl+⇧+H"] }],
      },
    }),
    platform: MACOS,
  });
  const press = () => cmdShift("H", "KeyH");
  assert.equal(dispatcher.resolve(press(), on("/extension/Port%20Scanner")), "extension.port-scanner.scan");
  assert.equal(dispatcher.resolve(press(), on("/extension/notes")), "extension.notes.jot");
  assert.equal(dispatcher.resolve(cmd("p", "KeyP"), on("/extension/notes")), "extension-page.notes.toggle-settings");
  assert.equal(dispatcher.resolve(press(), on("/ledger")), null);
  assert.equal(dispatcher.resolve(cmd("1", "Digit1"), on("/extension/notes")), "global.go-home");
});

test("WebSocket tab actions are inert while the modal is closed", () => {
  const dispatcher = mac();
  const state = { ...on("/ledger", requestDrawer(websocketUpgrade)), websocketTab: "inject" };
  assert.equal(dispatcher.resolve(cmdShift("D", "KeyD"), state), "ledger.drawer-open.unlink-test-case");
});
