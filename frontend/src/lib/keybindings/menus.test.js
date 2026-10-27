import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { CONTEXTS, contextsConflict, stepWebSocketTab } from "./contexts.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import { factoryKeybindings } from "./profiles.js";
import { validateKeybindings } from "./testing.js";

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

// The Ledger's drawer lives in the Ledger store, not Skeleton's drawer, so on
// the Ledger the layout reports it as `ledgerDrawer`.
function on(route, drawer = { open: false }) {
  if (route === "/ledger") {
    return {
      route,
      modal: null,
      dialogOpen: false,
      drawer: { open: false },
      ledgerDrawer: { open: drawer.open, meta: drawer.meta ?? null },
    };
  }
  return { route, modal: null, dialogOpen: false, drawer };
}

const requestDrawer = (meta = {}) => ({ open: true, id: "request-response", meta });
// Armory's drawer is part of its page too; the layout reports it as
// `armoryDrawer`.
const armoryDrawerOpen = () => ({ ...on("/armory"), armoryDrawer: { open: true } });
const websocketUpgrade = { metadata: { protocol: "websocket" } };

const mac = () => createDispatcher({ catalog: buildCatalog(), platform: MACOS });

test("⌘S searches, ⌘F filters and ⌘⇧O opens a request on the Ledger, drawer open or closed", () => {
  const dispatcher = mac();
  const closed = on("/ledger");
  const open = on("/ledger", requestDrawer());
  assert.equal(dispatcher.resolve(cmd("s", "KeyS"), closed), "ledger.drawer-closed.focus-query");
  assert.equal(dispatcher.resolve(cmd("s", "KeyS"), open), "ledger.drawer-open.focus-query");
  assert.equal(dispatcher.resolve(cmd("f", "KeyF"), closed), "ledger.drawer-closed.focus-exclusion");
  assert.equal(dispatcher.resolve(cmd("f", "KeyF"), open), "ledger.drawer-open.focus-exclusion");
  assert.equal(dispatcher.resolve(cmdShift("O", "KeyO"), open), "ledger.drawer-open.open-request");
  // ⌘⇧F still creates a finding with the drawer open; Settings moved to ⌘,.
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), open), "ledger.drawer-open.create-finding");
  assert.equal(dispatcher.resolve(cmd(",", "Comma"), closed), "global.go-settings");
  assert.equal(dispatcher.resolve(cmd("s", "KeyS"), on("/launchpad")), null, "⌘S is the Ledger's alone now");
});

test("with a selection, the row menu's shortcuts reach its actions", () => {
  const dispatcher = mac();
  const open = on("/ledger", requestDrawer());
  assert.equal(dispatcher.resolve(cmdShift(">", "Period"), open), "ledger.drawer-open.open-row-menu");
  assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), open), "ledger.drawer-open.send-to-launchpad");
  assert.equal(dispatcher.resolve(cmdShift("A", "KeyA"), open), "ledger.drawer-open.send-to-armory");
  assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), open), "ledger.drawer-open.create-test-case");
  assert.equal(dispatcher.resolve(cmdShift("N", "KeyN"), open), "ledger.drawer-open.view-note");
  assert.equal(dispatcher.resolve(cmdShift("C", "KeyC"), open), "ledger.drawer-open.copy-url");
  assert.equal(dispatcher.resolve(cmdShift("M", "KeyM"), open), "ledger.drawer-open.view-metadata");
  // The global actions keep their keys, with a selection or without.
  for (const state of [open, on("/ledger")]) {
    assert.equal(dispatcher.resolve(cmd(".", "Period"), state), "global.jump-to-toast");
    assert.equal(dispatcher.resolve(cmd("l", "KeyL"), state), "global.setup-listener");
  }
});

test("⌘⇧\\ jumps to the sitemap's find box with the drawer open or closed", () => {
  const dispatcher = mac();
  const press = () => cmdShift("|", "Backslash");
  assert.equal(dispatcher.resolve(press(), on("/ledger")), "ledger.drawer-closed.focus-sitemap");
  assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer())), "ledger.drawer-open.focus-sitemap");
});

test("with the drawer open, ⌘[ and ⌘] open the results' lowest and highest numbers", () => {
  const dispatcher = mac();
  const open = on("/ledger", requestDrawer());
  assert.equal(dispatcher.resolve(cmd("[", "BracketLeft"), open), "ledger.drawer-open.first-result");
  assert.equal(dispatcher.resolve(cmd("]", "BracketRight"), open), "ledger.drawer-open.last-result");
  assert.equal(dispatcher.resolve(cmd("]", "BracketRight"), on("/ledger")), "ledger.drawer-closed.next-page");
});

test("⌘\\ toggles the Ledger's sitemap dock with the drawer open or closed", () => {
  const dispatcher = mac();
  const press = () => cmd("\\", "Backslash");
  assert.equal(dispatcher.resolve(press(), on("/ledger")), "ledger.drawer-closed.toggle-sidebar");
  assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer())), "ledger.drawer-open.toggle-sidebar");
});

test("a Skeleton drawer over the Ledger, such as an extension's, is not the Ledger drawer", () => {
  const dispatcher = mac();
  const state = { ...on("/ledger"), drawer: { open: true, id: "extension-drawer", meta: {} } };
  assert.equal(dispatcher.resolve(cmd("f", "KeyF"), state), "ledger.drawer-closed.focus-exclusion");
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

test("⌘⇧G opens the WebSocket stream only from an upgrade request's drawer", () => {
  const dispatcher = mac();
  const press = () => cmdShift("G", "KeyG");
  assert.equal(dispatcher.resolve(cmdShift("O", "KeyO"), on("/ledger")), "ledger.drawer-closed.open-request");
  assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer())), null);
  assert.equal(
    dispatcher.resolve(cmdShift("O", "KeyO"), on("/ledger", requestDrawer(websocketUpgrade))),
    "ledger.drawer-open.open-request",
    "⌘⇧O opens a request on an upgrade row too",
  );
  assert.equal(
    dispatcher.resolve(press(), on("/ledger", requestDrawer(websocketUpgrade))),
    "ledger.drawer-open.websocket.open-stream",
  );
  assert.equal(
    dispatcher.resolve(press(), on("/ledger", requestDrawer({ incomingResponse: { StatusCode: 101 } }))),
    "ledger.drawer-open.websocket.open-stream",
  );
});

test("⌘⇧G does not open a stream for a failed or dropped upgrade", () => {
  const dispatcher = mac();
  const press = () => cmdShift("G", "KeyG");
  for (const state of ["failed", "dropped"]) {
    const meta = { metadata: { protocol: "websocket", "websocket.state": state } };
    assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer(meta))), null, state);
  }
});

test("⌘⇧] steps Armory runs on the page and the run's requests in its request drawer", () => {
  const dispatcher = mac();
  const press = () => cmdShift("]", "BracketRight");
  assert.equal(dispatcher.resolve(press(), on("/armory")), "armory.page.next-run");
  assert.equal(dispatcher.resolve(press(), armoryDrawerOpen()), "armory.drawer.next-request");
  assert.equal(dispatcher.resolve(cmd("p", "KeyP"), armoryDrawerOpen()), null);
  // Only Armory's own drawer replaces the Armory menu, not Skeleton's.
  for (const drawer of [requestDrawer(), { open: true, id: "extension-logs" }]) {
    assert.equal(dispatcher.resolve(press(), on("/armory", drawer)), "armory.page.next-run", drawer.id);
  }
});

test("each page's shared shortcuts run that page's action", () => {
  const dispatcher = mac();
  const expected = [
    ["/checkpoint", "checkpoint.toggle-settings", "checkpoint.show-logs"],
    ["/compass", "compass.toggle-settings", "compass.show-logs"],
    ["/workshop", "workshop.toggle-settings", "workshop.show-logs"],
  ];
  for (const [route, settings, shiftL] of expected) {
    assert.equal(dispatcher.resolve(cmd("p", "KeyP"), on(route)), settings, route);
    assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on(route)), shiftL, route);
  }
});

test("the Logbook's menu moves to the next record on N and has no settings to toggle", () => {
  const dispatcher = mac();
  const page = on("/logbook");
  assert.equal(dispatcher.resolve(keydown("n", "KeyN"), page), "logbook.next-record");
  assert.equal(dispatcher.resolve(cmdShift("S", "KeyS"), page), "logbook.focus-search");
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), page), "logbook.create-finding");
  assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), page), "logbook.create-test-case");
  assert.equal(dispatcher.resolve(cmdShift("E", "KeyE"), page), "logbook.export-report");
  assert.equal(dispatcher.resolve(cmd("p", "KeyP"), page), null);
  // N is typed, not run, in the search field, an inline fix or an editor.
  assert.equal(dispatcher.resolve(keydown("n", "KeyN", {}, { tagName: "INPUT" }), page), null);
  assert.equal(dispatcher.resolve(keydown("n", "KeyN", {}, { tagName: "TEXTAREA" }), page), null);
  // N is the Logbook's alone.
  assert.equal(dispatcher.resolve(keydown("n", "KeyN"), on("/ledger")), null);
});

test("the Logbook's N is bound on both platforms, and Esc stays with the page", () => {
  const catalog = buildCatalog();
  assert.deepEqual(catalog.get("logbook.next-record").defaults, { [MACOS]: ["n"], [WINDOWS_LINUX]: ["n"] });
  assert.equal(catalog.get("logbook.toggle-settings"), undefined);
  assert.equal(mac().resolve(keydown("Escape", "Escape"), on("/logbook")), null);
});

test("Checkpoint forwards picked items on ⌘⇧A, drops them on ⌘⇧X and intercepts the response on ⌘⇧S", () => {
  const dispatcher = mac();
  const page = on("/checkpoint");
  assert.equal(dispatcher.resolve(cmdShift("A", "KeyA"), page), "checkpoint.forward-picked");
  assert.equal(dispatcher.resolve(cmdShift("X", "KeyX"), page), "checkpoint.drop-picked");
  assert.equal(dispatcher.resolve(cmdShift("S", "KeyS"), page), "checkpoint.forward-intercept-response");
  // The single-item keys stay where they were.
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), page), "checkpoint.forward-intercepted");
  assert.equal(dispatcher.resolve(cmdShift("D", "KeyD"), page), "checkpoint.drop-intercepted");
  // An editor keeps none of them: the item and rules editors are where you work.
  const editor = { tagName: "DIV", isContentEditable: true, closest: (s) => (s === ".cm-editor" ? {} : null) };
  assert.equal(dispatcher.resolve(keydown("A", "KeyA", { metaKey: true, shiftKey: true }, editor), page), "checkpoint.forward-picked");
});

test("the Launchpad renames on ⌘R and swaps compared entries on ⌘⇧X", () => {
  const dispatcher = mac();
  assert.equal(dispatcher.resolve(cmd("r", "KeyR"), on("/launchpad")), "launchpad.toggle-settings");
  assert.equal(dispatcher.resolve(cmd("p", "KeyP"), on("/launchpad")), null);
  assert.equal(dispatcher.resolve(cmdShift("X", "KeyX"), on("/launchpad")), "launchpad.swap-compare");
  assert.equal(dispatcher.resolve(cmdShift("W", "KeyW"), on("/launchpad")), null);
  assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on("/launchpad")), "launchpad.launch");
});

test("a logs drawer keeps its page's menu", () => {
  const dispatcher = mac();
  const logs = { open: true, id: "extension-logs", meta: { extensionName: "checkpoint" } };
  assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on("/checkpoint", logs)), "checkpoint.show-logs");
  assert.equal(dispatcher.resolve(cmdShift("L", "KeyL"), on("/compass", logs)), "compass.show-logs");
});

test("global actions stay available on pages and in drawers", () => {
  const dispatcher = mac();
  for (const state of [on("/ledger"), on("/ledger", requestDrawer()), armoryDrawerOpen(), on("/workshop")]) {
    assert.equal(dispatcher.resolve(cmd("1", "Digit1"), state), "global.go-home", state.route);
  }
});

test("Windows/Linux page shortcuts use Ctrl", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX });
  const ctrlShift = (key, code) => keydown(key, code, { ctrlKey: true, shiftKey: true });
  const ctrl = (key, code) => keydown(key, code, { ctrlKey: true });
  assert.equal(dispatcher.resolve(ctrl("f", "KeyF"), on("/ledger")), "ledger.drawer-closed.focus-exclusion");
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

// Marasi stores whole WebSocket messages, so menu text says "message" while
// action ids keep "frame" (docs/adr/2026-10-11-websocket-action-ids-keep-frame.md).
const websocketMessageActions = [
  "websocket.stream.previous-frame",
  "websocket.stream.next-frame",
  "websocket.stream.toggle-frame-metadata",
  "websocket.stream.copy-frame-to-inject",
  "websocket.checkpoint.forward-frame",
  "websocket.checkpoint.drop-frame",
  "websocket.inject.inject-frame",
];

test("WebSocket menu actions say message, never frame, and keep their ids", () => {
  const catalog = buildCatalog();
  const websocketActions = catalog.actions.filter(
    (a) => a.context.startsWith("websocket") || a.id === "ledger.drawer-open.websocket.open-stream",
  );
  for (const a of websocketActions) {
    assert.doesNotMatch(`${a.label} | ${a.description} | ${a.keywords}`, /frame/i, a.id);
  }
  for (const id of websocketMessageActions) {
    const a = catalog.get(id);
    assert.ok(a, id);
    assert.match(a.label, /message/i, id);
    assert.match(a.keywords, /message/i, id);
  }
  assert.equal(catalog.get("websocket.stream.previous-frame").label, "Previous WebSocket Message");
  assert.equal(catalog.get("websocket.inject.inject-frame").label, "Inject WebSocket Message");
});

test("a saved profile that rebinds a relabelled WebSocket action still runs it", () => {
  const profile = {
    id: "work",
    name: "Work",
    overrides: {
      [MACOS]: [{ action: "websocket.stream.next-frame", keys: ["meta+shift+j"] }],
      [WINDOWS_LINUX]: [],
    },
    knownActions: buildCatalog().actions.map((a) => a.id),
  };
  const dispatcher = createDispatcher({
    catalog: buildCatalog(),
    platform: MACOS,
    keybindings: { config: { version: 1, activeProfile: "work", profiles: [profile] }, problem: "" },
  });
  assert.equal(dispatcher.resolve(cmdShift("J", "KeyJ"), websocketModal("stream")), "websocket.stream.next-frame");
  assert.equal(dispatcher.resolve(cmdShift("}", "BracketRight"), websocketModal("stream")), null);
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

test("the WebSocket modal closes on ⌘⇧G from every tab; ⌘⇧O stays the Inject tab's", () => {
  const dispatcher = mac();
  dispatcher.register("websocket.inject.cycle-opcode", () => {});
  const toggle = "ledger.drawer-open.websocket.open-stream";
  const press = () => cmdShift("G", "KeyG");
  for (const tab of ["stream", "checkpoint", "inject"]) {
    assert.equal(dispatcher.isModalToggle(press(), toggle, websocketModal(tab)), true, tab);
  }
  assert.equal(dispatcher.isModalToggle(cmdShift("O", "KeyO"), toggle, websocketModal("inject")), false);
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

test("the WebSocket Connection tab offers only the modal's shared actions", () => {
  const conflict = (a, b) => contextsConflict(CONTEXTS, a, b);
  assert.ok(conflict("websocket.connection", "websocket"));
  assert.ok(!conflict("websocket.connection", "websocket.stream"));
  assert.ok(!conflict("websocket.connection", "websocket.inject"));
  const catalog = buildCatalog();
  assert.ok(catalog.contexts.some((c) => c.id === "websocket.connection"));
  assert.deepEqual(catalog.actions.filter((a) => a.context === "websocket.connection"), []);

  const dispatcher = mac();
  const state = websocketModal("connection");
  assert.equal(dispatcher.resolve(cmd("[", "BracketLeft"), state), "websocket.previous-tab");
  assert.equal(dispatcher.resolve(cmd("]", "BracketRight"), state), "websocket.next-tab");
  assert.equal(dispatcher.resolve(cmdShift("X", "KeyX"), state), "websocket.close-connection");
  for (const [key, code] of [["D", "KeyD"], ["I", "KeyI"], ["F", "KeyF"], ["Enter", "Enter"], ["}", "BracketRight"]]) {
    assert.equal(dispatcher.resolve(cmdShift(key, code), state), null, key);
  }
});

test("the previous-tab and next-tab keys cycle through all four WebSocket tabs", () => {
  const forward = [];
  let tab = "stream";
  for (let i = 0; i < 4; i++) {
    tab = stepWebSocketTab(tab, 1);
    forward.push(tab);
  }
  assert.deepEqual(forward, ["checkpoint", "inject", "connection", "stream"]);
  assert.equal(stepWebSocketTab("stream", -1), "connection");
  assert.equal(stepWebSocketTab("connection", -1), "inject");
});

test("Launchpad page shortcuts run only on the Launchpad page", () => {
  const dispatcher = mac();
  const expected = [
    [cmd("\\", "Backslash"), "launchpad.toggle-sidebar"],
    [cmdShift("C", "KeyC"), "launchpad.toggle-compare"],
    [cmdShift("S", "KeyS"), "launchpad.focus-search"],
    [cmdShift("ArrowDown", "ArrowDown"), "launchpad.jump-to-latest"],
  ];
  for (const [event, actionId] of expected) {
    assert.equal(dispatcher.resolve(event, on("/launchpad")), actionId, event.key);
  }
  assert.equal(dispatcher.resolve(cmd("\\", "Backslash"), on("/checkpoint")), null);
  // The Ledger binds the same key to its own dock.
  assert.equal(dispatcher.resolve(cmd("\\", "Backslash"), on("/ledger")), "ledger.drawer-closed.toggle-sidebar");
});

test("jump to last entry leaves ⌘⇧↓ to a focused editor or text field", () => {
  const dispatcher = mac();
  const codeMirror = { tagName: "DIV", isContentEditable: true, closest: (s) => (s.includes(".cm-editor") ? {} : null) };
  const field = { tagName: "INPUT", closest: () => null };
  for (const target of [codeMirror, field]) {
    const event = keydown("ArrowDown", "ArrowDown", { metaKey: true, shiftKey: true }, target);
    assert.equal(dispatcher.resolve(event, on("/launchpad")), null, target.tagName);
  }
  // Other Launchpad shortcuts still run from the request editor.
  const compare = keydown("C", "KeyC", { metaKey: true, shiftKey: true }, codeMirror);
  assert.equal(dispatcher.resolve(compare, on("/launchpad")), "launchpad.toggle-compare");
});

test("⌘A selects every entry only while the Launchpad tree has focus, and not from its search box", () => {
  const dispatcher = mac();
  const tree = { ...on("/launchpad"), launchpadTreeFocused: true };
  assert.equal(dispatcher.resolve(cmd("a", "KeyA"), tree), "launchpad.tree.select-all-entries");
  assert.equal(dispatcher.resolve(cmd("a", "KeyA"), on("/launchpad")), null);
  const search = keydown("a", "KeyA", { metaKey: true }, { tagName: "INPUT", closest: () => null });
  assert.equal(dispatcher.resolve(search, tree), null);
  // The page's own shortcuts still run from the tree.
  assert.equal(dispatcher.resolve(cmdShift("C", "KeyC"), tree), "launchpad.toggle-compare");
  // Both are eligible together, so one key cannot serve both.
  assert.ok(contextsConflict(CONTEXTS, "launchpad.tree", "launchpad"));
});

test("⌥ arrows move the entry selection only while the Launchpad tree has focus, and not from an editor", () => {
  const alt = (key, mods = {}, target) => keydown(key, key, { altKey: true, ...mods }, target);
  const tree = { ...on("/launchpad"), launchpadTreeFocused: true };
  for (const dispatcher of [mac(), createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX })]) {
    assert.equal(dispatcher.resolve(alt("ArrowUp"), tree), "launchpad.tree.move-entries-up");
    assert.equal(dispatcher.resolve(alt("ArrowDown"), tree), "launchpad.tree.move-entries-down");
    assert.equal(dispatcher.resolve(alt("ArrowUp", { shiftKey: true }), tree), "launchpad.tree.move-entries-top");
    assert.equal(dispatcher.resolve(alt("ArrowDown", { shiftKey: true }), tree), "launchpad.tree.move-entries-bottom");
    assert.equal(dispatcher.resolve(alt("ArrowUp"), on("/launchpad")), null);
    // ⌥↑ moves a line in CodeMirror; the tree's search box keeps it too.
    const search = alt("ArrowUp", {}, { tagName: "INPUT", closest: () => null });
    assert.equal(dispatcher.resolve(search, tree), null);
  }
});

test("no Launchpad default hides a global shortcut", () => {
  const catalog = buildCatalog();
  for (const platform of [MACOS, WINDOWS_LINUX]) {
    const global = new Map(
      catalog.inContext("global").flatMap((a) => a.defaults[platform].map((binding) => [binding, a.id])),
    );
    for (const action of catalog.inContext("launchpad")) {
      for (const binding of action.defaults[platform]) {
        assert.equal(global.get(binding), undefined, `${platform} ${binding}: ${action.id} hides ${global.get(binding)}`);
      }
    }
  }
});
