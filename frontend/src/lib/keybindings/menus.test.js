import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { buildMenu } from "../components/MarasiMenu/menuModel.js";
import { hiddenInMenu } from "../platform.js";
import { projectBottomBar, resolveRailPages } from "../railOrder.js";
import { CONTEXTS, contextsConflict, eligibleContextIds, stepWebSocketTab } from "./contexts.js";
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

test("⌘⇧G opens a streamed pair's messages from its drawer, a live one whose response hasn't started too", () => {
  const dispatcher = mac();
  const press = () => cmdShift("G", "KeyG");
  const live = { streamed: { request: { framing: "grpc", ending: null }, response: null } };
  const ended = { streamed: { request: null, response: { framing: "sse", ending: "complete" } } };
  for (const meta of [live, ended]) {
    assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer(meta))), "ledger.drawer-open.websocket.open-stream");
  }
  assert.equal(dispatcher.resolve(press(), on("/ledger", requestDrawer({ streamed: null }))), null);
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

test("the Logbook moves to the next record on ⌘⇧] and has no settings to toggle", () => {
  const dispatcher = mac();
  const page = on("/logbook");
  assert.equal(dispatcher.resolve(cmdShift("}", "BracketRight"), page), "logbook.next-record");
  assert.equal(dispatcher.resolve(cmdShift("S", "KeyS"), page), "logbook.focus-search");
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), page), "logbook.create-finding");
  assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), page), "logbook.create-test-case");
  assert.equal(dispatcher.resolve(cmdShift("E", "KeyE"), page), "logbook.export-report");
  assert.equal(dispatcher.resolve(cmd("p", "KeyP"), page), null);
  // A bare N no longer runs anything.
  assert.equal(dispatcher.resolve(keydown("n", "KeyN"), page), null);
});

test("Next Record is ⌘⇧] (Ctrl+Shift+]) on both platforms, and Esc stays with the page", () => {
  const catalog = buildCatalog();
  assert.deepEqual(catalog.get("logbook.next-record").defaults, { [MACOS]: ["meta+shift+]"], [WINDOWS_LINUX]: ["ctrl+shift+]"] });
  assert.equal(catalog.get("logbook.toggle-settings"), undefined);
  assert.equal(mac().resolve(keydown("Escape", "Escape"), on("/logbook")), null);
});

test("the Checkpoint page turns Stream intercept over on ⌘⇧T", () => {
  const dispatcher = mac();
  assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), on("/checkpoint")), "checkpoint.toggle-stream-intercept");
  assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), on("/ledger")), null);
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
    ["stream", cmd("j", "KeyJ"), "websocket.stream.jump-to-bottom"],
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

const streamModal = (streamTab) => ({
  ...on("/ledger", requestDrawer()),
  modal: "WebsocketStream",
  streamTab,
  websocketTab: null,
});

test("the streamed pair modal's actions take their WebSocket counterparts' keys", () => {
  const dispatcher = mac();
  const expected = [
    ["messages", cmdShift("{", "BracketLeft"), "stream.messages.previous-message"],
    ["messages", cmdShift("}", "BracketRight"), "stream.messages.next-message"],
    ["messages", cmd("j", "KeyJ"), "stream.messages.jump-to-bottom"],
    ["messages", cmdShift("M", "KeyM"), "stream.messages.toggle-message-metadata"],
    ["messages", cmdShift("R", "KeyR"), "stream.messages.toggle-raw"],
    ["messages", cmdShift("I", "KeyI"), "stream.messages.copy-message-to-inject"],
    ["messages", cmdShift("Enter", "Enter"), null],
    ["checkpoint", cmdShift("I", "KeyI"), "stream.checkpoint.toggle-intercept"],
    ["checkpoint", cmdShift("F", "KeyF"), "stream.checkpoint.forward-message"],
    ["checkpoint", cmdShift("D", "KeyD"), "stream.checkpoint.drop-message"],
    ["checkpoint", cmdShift("M", "KeyM"), null],
    ["inject", cmdShift("D", "KeyD"), "stream.inject.toggle-direction"],
    ["inject", cmdShift("Enter", "Enter"), "stream.inject.inject-message"],
    ["inject", cmdShift("I", "KeyI"), null],
    ["pair", cmdShift("M", "KeyM"), null],
  ];
  for (const [tab, event, actionId] of expected) {
    assert.equal(dispatcher.resolve(event, streamModal(tab)), actionId, `${tab} ${event.key}`);
  }
  for (const tab of ["messages", "checkpoint", "inject", "pair"]) {
    assert.equal(dispatcher.resolve(cmd("[", "BracketLeft"), streamModal(tab)), "stream.previous-tab");
    assert.equal(dispatcher.resolve(cmd("]", "BracketRight"), streamModal(tab)), "stream.next-tab");
    assert.equal(dispatcher.resolve(cmd("1", "Digit1"), streamModal(tab)), "global.go-home");
    // Cancel takes Close Connection's key, on every tab.
    assert.equal(dispatcher.resolve(cmdShift("X", "KeyX"), streamModal(tab)), "stream.cancel-pair");
  }
});

test("stream actions say message, never frame, and the WebSocket ids are unchanged", () => {
  const catalog = buildCatalog();
  const streamActions = catalog.actions.filter((a) => a.context === "stream" || a.context.startsWith("stream."));
  assert.ok(streamActions.length >= 7);
  for (const a of streamActions) {
    assert.doesNotMatch(`${a.id} | ${a.label} | ${a.description} | ${a.keywords}`, /frame|websocket/i, a.id);
  }
  for (const id of websocketMessageActions) assert.ok(catalog.get(id), id);
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
    [cmd("j", "KeyJ"), "launchpad.jump-to-latest"],
  ];
  for (const [event, actionId] of expected) {
    assert.equal(dispatcher.resolve(event, on("/launchpad")), actionId, event.key);
  }
  assert.equal(dispatcher.resolve(cmd("\\", "Backslash"), on("/checkpoint")), null);
  // The Ledger binds the same key to its own dock.
  assert.equal(dispatcher.resolve(cmd("\\", "Backslash"), on("/ledger")), "ledger.drawer-closed.toggle-sidebar");
});

test("jump to last entry runs on ⌘J from the request editor and a text field too", () => {
  const dispatcher = mac();
  const codeMirror = { tagName: "DIV", isContentEditable: true, closest: (s) => (s.includes(".cm-editor") ? {} : null) };
  const field = { tagName: "INPUT", closest: () => null };
  for (const target of [codeMirror, field]) {
    assert.equal(dispatcher.resolve(keydown("j", "KeyJ", { metaKey: true }, target), on("/launchpad")), "launchpad.jump-to-latest", target.tagName);
  }
  // ⌘⇧↓ is no longer Marasi's on the Launchpad: it selects to the end in a field.
  assert.equal(dispatcher.resolve(cmdShift("ArrowDown", "ArrowDown"), on("/launchpad")), null);
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

test("⌘⇧ arrows move the entry selection a step and ⌘ arrows to the ends, only while the Launchpad tree has focus", () => {
  const tree = { ...on("/launchpad"), launchpadTreeFocused: true };
  for (const [dispatcher, mod] of [[mac(), "metaKey"], [createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX }), "ctrlKey"]]) {
    const press = (key, shift, target) => keydown(key, key, { [mod]: true, shiftKey: shift }, target);
    assert.equal(dispatcher.resolve(press("ArrowUp", true), tree), "launchpad.tree.move-entries-up");
    assert.equal(dispatcher.resolve(press("ArrowDown", true), tree), "launchpad.tree.move-entries-down");
    assert.equal(dispatcher.resolve(press("ArrowUp", false), tree), "launchpad.tree.move-entries-top");
    assert.equal(dispatcher.resolve(press("ArrowDown", false), tree), "launchpad.tree.move-entries-bottom");
    assert.equal(dispatcher.resolve(press("ArrowUp", true), on("/launchpad")), null);
    // A field or editor keeps them (caret and selection moves); so does the
    // tree's search box.
    const search = press("ArrowUp", false, { tagName: "INPUT", closest: () => null });
    assert.equal(dispatcher.resolve(search, tree), null);
  }
});

test("⌘⇧F and ⌘⇧B start a finding or test case only while the Launchpad tree has focus", () => {
  const tree = { ...on("/launchpad"), launchpadTreeFocused: true };
  const dispatcher = mac();
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), tree), "launchpad.tree.create-finding");
  assert.equal(dispatcher.resolve(cmdShift("B", "KeyB"), tree), "launchpad.tree.create-test-case");
  assert.equal(dispatcher.resolve(cmdShift("F", "KeyF"), on("/launchpad")), null);
  assert.equal(dispatcher.resolve(cmdShift("B", "KeyB"), on("/launchpad")), null);
  // ⌘⇧T stays Toggle TLS from the tree.
  assert.equal(dispatcher.resolve(cmdShift("T", "KeyT"), tree), "launchpad.toggle-tls");
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

test("⌘=, ⌘- and ⌘0 change the Text size on every page and in drawers", () => {
  const dispatcher = mac();
  const states = [
    on("/"),
    on("/ledger"),
    on("/ledger", requestDrawer()),
    on("/launchpad"),
    on("/checkpoint"),
    armoryDrawerOpen(),
    on("/logbook"),
    on("/compass"),
    on("/workshop"),
    on("/settings"),
  ];
  for (const state of states) {
    assert.equal(dispatcher.resolve(cmd("=", "Equal"), state), "global.increase-text-size", state.route);
    assert.equal(dispatcher.resolve(cmd("-", "Minus"), state), "global.decrease-text-size", state.route);
    assert.equal(dispatcher.resolve(cmd("0", "Digit0"), state), "global.reset-text-size", state.route);
  }
  // There is no ⌘⇧= (⌘+).
  assert.equal(dispatcher.resolve(cmdShift("+", "Equal"), on("/")), null);
});

test("no other action's default takes the Text size keys", () => {
  const catalog = buildCatalog();
  const textSize = ["global.increase-text-size", "global.decrease-text-size", "global.reset-text-size"];
  for (const platform of [MACOS, WINDOWS_LINUX]) {
    const keys = new Map(
      textSize.map((id) => [catalog.get(id)?.defaults[platform][0], id]),
    );
    assert.equal(keys.size, 3, `${platform}: three distinct keys`);
    for (const action of catalog.actions) {
      if (textSize.includes(action.id)) continue;
      for (const binding of action.defaults[platform]) {
        assert.equal(keys.get(binding), undefined, `${platform} ${binding}: ${action.id} takes ${keys.get(binding)}`);
      }
    }
  }
});

test("⌘A selects the Armory run's traffic, but not from the template editor or a field", () => {
  const dispatcher = mac();
  assert.equal(dispatcher.resolve(cmd("a", "KeyA"), on("/armory")), "armory.page.select-all-traffic");
  const codeMirror = { tagName: "DIV", isContentEditable: true, closest: (s) => (s.includes(".cm-editor") ? {} : null) };
  const field = { tagName: "INPUT", closest: () => null };
  for (const target of [codeMirror, field]) {
    const event = keydown("a", "KeyA", { metaKey: true }, target);
    assert.equal(dispatcher.resolve(event, on("/armory")), null, target.tagName);
  }
});

// Every menu context, each in a dispatcher state where it is eligible.
function everyContextState() {
  return [
    on("/"),
    ...["stream", "checkpoint", "inject", "connection"].map((tab) => websocketModal(tab)),
    ...["messages", "checkpoint", "inject", "pair"].map((tab) => streamModal(tab)),
    on("/ledger"),
    on("/ledger", requestDrawer()),
    on("/ledger", requestDrawer(websocketUpgrade)),
    on("/armory"),
    armoryDrawerOpen(),
    ...["launchpad", "checkpoint", "logbook", "compass", "workshop", "cyberchef", "excalidraw"].map((page) => on(`/${page}`)),
    { ...on("/launchpad"), launchpadTreeFocused: true },
    on("/extension/Repeater"),
  ];
}

test("⌘9 and Ctrl+9 open Connections… from every menu context", () => {
  const catalog = buildCatalog({ extensions: [{ Name: "Repeater" }] });
  const keybindings = { config: factoryKeybindings(), problem: "" };
  const mac = createDispatcher({ catalog, platform: MACOS, keybindings });
  const other = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings });
  for (const state of everyContextState()) {
    const label = `${state.route} ${state.modal ?? ""} ${state.websocketTab ?? ""}`;
    assert.equal(mac.resolve(cmd("9", "Digit9"), state), "global.connections", label);
    assert.equal(other.resolve(keydown("9", "Digit9", { ctrlKey: true }), state), "global.connections", label);
  }
});

test("Connections… bound in a custom profile opens from every menu context", () => {
  const catalog = buildCatalog({ extensions: [{ Name: "Repeater" }] });
  const profile = {
    id: "work",
    name: "Work",
    overrides: {
      [MACOS]: [{ action: "global.connections", keys: ["meta+shift+9"] }],
      [WINDOWS_LINUX]: [{ action: "global.connections", keys: ["ctrl+shift+9"] }],
    },
    knownActions: catalog.actions.map((a) => a.id),
  };
  const config = { version: 1, activeProfile: "work", profiles: [profile] };
  assert.deepEqual(validateKeybindings(catalog, config), []);

  const states = everyContextState();
  const covered = new Set(states.flatMap((state) => eligibleContextIds(state, catalog.contexts)));
  for (const context of catalog.contexts) {
    assert.ok(covered.has(context.id), `no state covers ${context.id}`);
  }

  const mac = createDispatcher({ catalog, platform: MACOS, keybindings: { config, problem: "" } });
  const other = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings: { config, problem: "" } });
  for (const state of states) {
    const label = `${state.route} ${state.modal ?? ""} ${state.websocketTab ?? ""}`;
    assert.equal(mac.resolve(cmdShift("(", "Digit9"), state), "global.connections", label);
    assert.equal(
      other.resolve(keydown("(", "Digit9", { ctrlKey: true, shiftKey: true }), state),
      "global.connections",
      label,
    );
  }
});

test("the CyberChef page has its own menu, and Go to CyberChef is ⌘⇧Y everywhere", () => {
  const dispatcher = mac();
  const chef = on("/cyberchef");
  assert.equal(dispatcher.resolve(cmdShift("Enter", "Enter"), chef), "cyberchef.bake");
  assert.equal(dispatcher.resolve(cmdShift("N", "KeyN"), chef), "cyberchef.new-recipe");
  assert.equal(dispatcher.resolve(cmdShift("O", "KeyO"), chef), "cyberchef.switch-recipe");
  assert.equal(dispatcher.resolve(cmdShift("R", "KeyR"), chef), "cyberchef.rename-recipe");
  assert.equal(dispatcher.resolve(cmdShift("E", "KeyE"), chef), "cyberchef.duplicate-recipe");
  assert.equal(dispatcher.resolve(cmdShift("I", "KeyI"), chef), "cyberchef.insert");
  assert.equal(dispatcher.resolve(cmdShift("A", "KeyA"), chef), "cyberchef.attach");
  assert.equal(dispatcher.resolve(cmdShift("D", "KeyD"), chef), "cyberchef.delete-recipe");
  // The recipe keys are CyberChef's alone.
  assert.equal(dispatcher.resolve(cmdShift("Enter", "Enter"), on("/")), null);
  for (const state of [on("/"), on("/ledger"), chef, on("/workshop")]) {
    assert.equal(dispatcher.resolve(cmdShift("Y", "KeyY"), state), "global.go-cyberchef", state.route);
  }
});

test("Send to CyberChef is ⌘E from any editor, the Ledger query editor included", () => {
  const dispatcher = mac();
  const inEditor = { tagName: "DIV", isContentEditable: true, closest: (s) => (s === ".cm-editor" ? {} : null) };
  // The query editor gets the key too: the handler refuses it with a toast.
  const inQuery = { tagName: "DIV", isContentEditable: true, closest: (s) => (s === ".cm-editor" || s === ".ledger-query" ? {} : null) };
  const states = [
    on("/ledger", requestDrawer()),
    on("/ledger"),
    on("/launchpad"),
    on("/checkpoint"),
    on("/logbook"),
    on("/"),
  ];
  for (const state of states) {
    assert.equal(dispatcher.resolve(keydown("e", "KeyE", { metaKey: true }, inEditor), state), "global.send-to-cyberchef", state.route);
    assert.equal(dispatcher.resolve(cmd("e", "KeyE"), state), "global.send-to-cyberchef", state.route);
  }
  assert.equal(dispatcher.resolve(keydown("e", "KeyE", { metaKey: true }, inQuery), on("/ledger")), "global.send-to-cyberchef");
});

test("⌘K and Bake reach the dispatcher from CyberChef's input editor and its search field", () => {
  const dispatcher = mac();
  const chef = on("/cyberchef");
  const editor = { tagName: "DIV", isContentEditable: true, closest: (s) => (s === ".cm-editor" ? {} : null) };
  const search = { tagName: "INPUT", id: "search", closest: () => null };
  for (const target of [editor, search]) {
    assert.equal(dispatcher.resolve(keydown("k", "KeyK", { metaKey: true }, target), chef), "global.open-menu", target.tagName);
    assert.equal(dispatcher.resolve(keydown("Enter", "Enter", { metaKey: true, shiftKey: true }, target), chef), "cyberchef.bake", target.tagName);
  }
  // CyberChef's own Ctrl+Alt keys stay with it.
  const ctrlAltB = keydown("∫", "KeyB", { ctrlKey: true, altKey: true }, editor);
  assert.equal(dispatcher.resolve(ctrlAltB, chef), null);
});

// The Excalidraw canvas: a target inside Excalidraw's own `.excalidraw` root.
const onCanvas = { tagName: "CANVAS", closest: (s) => (s.includes(".excalidraw") ? {} : null) };
const onCanvasCmd = (key, code, mods = {}) => keydown(key, code, { metaKey: true, ...mods }, onCanvas);

test("the Excalidraw page's actions run on their keys, on the canvas too", () => {
  const dispatcher = mac();
  const page = on("/excalidraw");
  const expected = [
    [cmdShift("N", "KeyN"), "excalidraw.new-drawing"],
    [cmdShift("O", "KeyO"), "excalidraw.switch-drawing"],
    [cmdShift("R", "KeyR"), "excalidraw.rename-drawing"],
    [cmdShift("E", "KeyE"), "excalidraw.duplicate-drawing"],
    [cmdShift("D", "KeyD"), "excalidraw.delete-drawing"],
    [cmdShift("I", "KeyI"), "excalidraw.insert"],
    [cmdShift("A", "KeyA"), "excalidraw.attach"],
    [cmd("/", "Slash"), "excalidraw.shortcuts"],
  ];
  for (const [event, id] of expected) {
    assert.equal(dispatcher.resolve(event, page), id, id);
    assert.equal(dispatcher.resolve({ ...event, target: onCanvas }, page), id, `${id} on the canvas`);
  }
  assert.equal(dispatcher.resolve(cmd("/", "Slash"), on("/ledger")), null, "⌘/ is Excalidraw's alone");
});

test("Go to Excalidraw is ⌘⇧J from every page", () => {
  const dispatcher = mac();
  for (const state of [on("/"), on("/ledger"), on("/excalidraw")]) {
    assert.equal(dispatcher.resolve(cmdShift("J", "KeyJ"), state), "global.go-excalidraw", state.route);
  }
});

test("Excalidraw keeps its editing keys while focus is on the canvas", () => {
  const dispatcher = mac();
  const page = on("/excalidraw");
  const kept = [
    onCanvasCmd("d", "KeyD"),
    onCanvasCmd("=", "Equal"),
    onCanvasCmd("-", "Minus"),
    onCanvasCmd("0", "Digit0"),
    onCanvasCmd("g", "KeyG"),
    onCanvasCmd("G", "KeyG", { shiftKey: true }),
  ];
  for (const event of kept) assert.equal(dispatcher.resolve(event, page), null, event.key);
  // Off the canvas, the same keys are Marasi's.
  assert.equal(dispatcher.resolve(cmd("d", "KeyD"), page), "global.download-certificate");
  assert.equal(dispatcher.resolve(cmd("0", "Digit0"), page), "global.reset-text-size");
  // ⌘K and the rest still reach Marasi from the canvas.
  assert.equal(dispatcher.resolve(onCanvasCmd("k", "KeyK"), page), "global.open-menu");
  assert.equal(dispatcher.resolve(onCanvasCmd("2", "Digit2"), page), "global.go-ledger");
});

test("Excalidraw keeps Ctrl versions of its keys on Windows/Linux", () => {
  const dispatcher = createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX });
  const event = keydown("d", "KeyD", { ctrlKey: true }, onCanvas);
  assert.equal(dispatcher.resolve(event, on("/excalidraw")), null);
  assert.equal(dispatcher.resolve({ ...event, target: { tagName: "BODY" } }, on("/excalidraw")), "global.download-certificate");
});

test("Add to Drawing is ⌘⇧; from the Ledger, drawer open or closed", () => {
  const dispatcher = mac();
  assert.equal(dispatcher.resolve(cmdShift(":", "Semicolon"), on("/ledger", requestDrawer())), "global.add-to-drawing");
  assert.equal(dispatcher.resolve(cmdShift(":", "Semicolon"), on("/ledger")), "global.add-to-drawing");
});

test("⌘⇧P and Ctrl+Shift+P toggle the proxy listener from every menu context", () => {
  const catalog = buildCatalog({ extensions: [{ Name: "Repeater" }] });
  const keybindings = { config: factoryKeybindings(), problem: "" };
  const macDispatcher = createDispatcher({ catalog, platform: MACOS, keybindings });
  const otherDispatcher = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings });
  for (const state of everyContextState()) {
    const label = `${state.route} ${state.modal ?? ""} ${state.websocketTab ?? ""}`;
    assert.equal(macDispatcher.resolve(cmdShift("P", "KeyP"), state), "global.toggle-listener", label);
    assert.equal(
      otherDispatcher.resolve(keydown("P", "KeyP", { ctrlKey: true, shiftKey: true }), state),
      "global.toggle-listener",
      label,
    );
  }
});

test("Interactsh is in the Go to menu group, unbound by default, and runs from every context when bound", () => {
  const catalog = buildCatalog({ extensions: [{ Name: "Repeater" }] });
  const factory = createDispatcher({ catalog, platform: MACOS, keybindings: { config: factoryKeybindings(), problem: "" } });
  assert.deepEqual(factory.bindingsFor("global.go-interact"), []);

  const globalEntries = catalog
    .inContext("global")
    .filter((action) => action.id !== "global.open-menu")
    .map((action) => ({ actionId: action.id }));
  const factoryMenu = buildMenu({
    catalog,
    globalEntries,
    bindingsFor: factory.bindingsFor,
    platform: MACOS,
  });
  const goTo = factoryMenu.sections.flatMap((s) => s.groups).find((g) => g.id === "global.go");
  const interactRow = goTo.items.find((item) => item.actionId === "global.go-interact");
  assert.ok(interactRow, "Interactsh appears in Go to menu group");
  assert.equal(interactRow.name, "Interactsh");
  assert.equal(interactRow.menuKey, null);

  const profile = {
    id: "work",
    name: "Work",
    overrides: {
      [MACOS]: [{ action: "global.go-interact", keys: ["meta+shift+h"] }],
      [WINDOWS_LINUX]: [{ action: "global.go-interact", keys: ["ctrl+shift+h"] }],
    },
    knownActions: catalog.actions.map((a) => a.id),
  };
  const config = { version: 1, activeProfile: "work", profiles: [profile] };
  assert.deepEqual(validateKeybindings(catalog, config), []);

  const macDispatcher = createDispatcher({ catalog, platform: MACOS, keybindings: { config, problem: "" } });
  const winDispatcher = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings: { config, problem: "" } });
  for (const state of everyContextState()) {
    const label = `${state.route} ${state.modal ?? ""} ${state.websocketTab ?? ""}`;
    assert.equal(macDispatcher.resolve(cmdShift("H", "KeyH"), state), "global.go-interact", label);
    assert.equal(
      winDispatcher.resolve(keydown("H", "KeyH", { ctrlKey: true, shiftKey: true }), state),
      "global.go-interact",
      label,
    );
  }
  const boundMenu = buildMenu({
    catalog,
    globalEntries,
    bindingsFor: macDispatcher.bindingsFor,
    platform: MACOS,
  });
  const boundRow = boundMenu.sections.flatMap((s) => s.groups).find((g) => g.id === "global.go").items.find((item) => item.actionId === "global.go-interact");
  assert.equal(boundRow.menuKey, "meta+shift+h");
});

test("reconfiguring the dispatcher with a custom rail order immediately updates ⌘2-⌘8 / Ctrl+2-8 and ⌘K → Go to", () => {
  const customOrder = [
    "cyberchef",  // slot 2 -> ⌘2 / Ctrl+2
    "interact",   // slot 3 -> ⌘3 / Ctrl+3
    "launchpad",  // slot 4 -> ⌘4 / Ctrl+4
    "ledger",     // slot 5 -> ⌘5 / Ctrl+5
    "logbook",    // slot 6 -> ⌘6 / Ctrl+6
    "armory",     // slot 7 -> ⌘7 / Ctrl+7
    "checkpoint", // slot 8 -> ⌘8 / Ctrl+8
    "workshop",   // slot 9 -> unbound
    "excalidraw", // slot 10 -> fallback ⌘⇧J / Ctrl+Shift+J
    "compass",    // slot 11 -> unbound
  ];
  const macDispatcher = createDispatcher({ catalog: buildCatalog(), platform: MACOS });
  const winDispatcher = createDispatcher({ catalog: buildCatalog(), platform: WINDOWS_LINUX });
  assert.equal(macDispatcher.resolve(cmd("2", "Digit2"), on("/")), "global.go-ledger");

  const nextCatalog = buildCatalog({ railOrder: customOrder, extensions: [{ Name: "Repeater" }] });
  macDispatcher.configure({ catalog: nextCatalog });
  winDispatcher.configure({ catalog: nextCatalog });

  // Live shortcuts update immediately on both platforms without restarting.
  assert.equal(macDispatcher.resolve(cmd("1", "Digit1"), on("/")), "global.go-home");
  assert.equal(macDispatcher.resolve(cmd("2", "Digit2"), on("/")), "global.go-cyberchef");
  assert.equal(macDispatcher.resolve(cmd("3", "Digit3"), on("/")), "global.go-interact");
  assert.equal(macDispatcher.resolve(cmd("4", "Digit4"), on("/")), "global.go-launchpad");
  assert.equal(macDispatcher.resolve(cmd("8", "Digit8"), on("/")), "global.go-checkpoint");
  assert.equal(macDispatcher.resolve(cmd("9", "Digit9"), on("/")), "global.connections");
  assert.equal(macDispatcher.resolve(cmd("0", "Digit0"), on("/")), "global.reset-text-size");
  assert.equal(macDispatcher.resolve(cmd(",", "Comma"), on("/")), "global.go-settings");
  assert.equal(macDispatcher.resolve(cmdShift("Y", "KeyY"), on("/")), null, "CyberChef moved into slot 2 so fallback ⌘⇧Y no longer fires");
  assert.equal(macDispatcher.resolve(cmdShift("J", "KeyJ"), on("/")), "global.go-excalidraw");

  const ctrl = (key, code) => keydown(key, code, { ctrlKey: true });
  assert.equal(winDispatcher.resolve(ctrl("2", "Digit2"), on("/")), "global.go-cyberchef");
  assert.equal(winDispatcher.resolve(ctrl("3", "Digit3"), on("/")), "global.go-interact");
  assert.equal(winDispatcher.resolve(ctrl("9", "Digit9"), on("/")), "global.connections");
  assert.equal(winDispatcher.resolve(ctrl("0", "Digit0"), on("/")), "global.reset-text-size");

  // ⌘K → Go to lists pages in rail order with their live resolved shortcuts.
  const globalEntries = nextCatalog
    .inContext("global")
    .filter((action) => action.id !== "global.open-menu")
    .map((action) => ({ actionId: action.id }));
  const menu = buildMenu({
    catalog: nextCatalog,
    globalEntries,
    bindingsFor: macDispatcher.bindingsFor,
    platform: MACOS,
  });
  const goTo = menu.sections.flatMap((s) => s.groups).find((g) => g.id === "global.go");
  assert.deepEqual(
    goTo.items.map((item) => [item.actionId, item.menuKey]),
    [
      ["global.go-home", "meta+1"],
      ["global.go-cyberchef", "meta+2"],
      ["global.go-interact", "meta+3"],
      ["global.go-launchpad", "meta+4"],
      ["global.go-ledger", "meta+5"],
      ["global.go-logbook", "meta+6"],
      ["global.go-armory", "meta+7"],
      ["global.go-checkpoint", "meta+8"],
      ["global.go-workshop", null],
      ["global.go-excalidraw", "meta+shift+j"],
      ["global.go-compass", null],
      ["global.go-settings", "meta+,"],
      ["global.open-extension.repeater", "meta+alt+1"],
    ],
  );
});

test("shortcut numbering stays anchored to the unfiltered saved rail order when CyberChef is hidden on narrow viewports", () => {
  const customOrder = [
    "cyberchef",  // index 0 -> slot 2 (hidden on narrow viewport, but slot 2 stays anchored to it)
    "launchpad",  // index 1 -> slot 3 -> stays ⌘3 / Ctrl+3 even though it is the first visible tab after Home
    "ledger",     // index 2 -> slot 4 -> stays ⌘4 / Ctrl+4
    "logbook",
    "interact",
    "excalidraw",
    "checkpoint",
    "armory",
    "compass",
    "workshop",
  ];
  const narrowBar = projectBottomBar(resolveRailPages(customOrder), { chefShown: false });
  assert.deepEqual(
    narrowBar.primary.map((p) => p.id),
    ["home", "launchpad", "ledger", "logbook", "interact"],
    "narrow bottom bar skips hidden CyberChef so 5 tabs stay full",
  );

  // Catalog built from the unfiltered rail order keeps Launchpad at slot 3 (⌘3), not shifted to ⌘2.
  const catalog = buildCatalog({ railOrder: customOrder });
  const dispatcher = createDispatcher({ catalog, platform: MACOS });
  assert.equal(dispatcher.resolve(cmd("3", "Digit3"), on("/")), "global.go-launchpad");
  assert.equal(dispatcher.resolve(cmd("4", "Digit4"), on("/")), "global.go-ledger");

  // Even when GlobalMenu filters hiddenInMenu({ mobile: true, chefShown: false }), remaining Go to shortcuts stay anchored.
  const visibleGlobalEntries = catalog
    .inContext("global")
    .filter((action) => action.id !== "global.open-menu" && !hiddenInMenu(action.id, { mobile: true, chefShown: false }))
    .map((action) => ({ actionId: action.id }));
  const menu = buildMenu({
    catalog,
    globalEntries: visibleGlobalEntries,
    bindingsFor: dispatcher.bindingsFor,
    platform: MACOS,
  });
  const goTo = menu.sections.flatMap((s) => s.groups).find((g) => g.id === "global.go");
  assert.deepEqual(
    goTo.items.slice(0, 4).map((item) => [item.actionId, item.menuKey]),
    [
      ["global.go-home", "meta+1"],
      ["global.go-launchpad", "meta+3"],
      ["global.go-ledger", "meta+4"],
      ["global.go-logbook", "meta+5"],
    ],
  );
});
