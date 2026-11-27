import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byteSizeText,
  commandStripCopyActions,
  drawerCopyActions,
  highlightSwatchTitle,
  noteIndicator,
  pairHasResponse,
  pairSummary,
  paneHeaderState,
  rightRailWorkflowActions,
  shortcutTooltip,
} from "./drawerPresentation.js";

test("byteSizeText formats UTF-8 byte lengths for empty, raw, and larger bodies", () => {
  assert.equal(byteSizeText(""), "");
  assert.equal(byteSizeText(null), "");
  assert.equal(byteSizeText(undefined), "");
  assert.equal(byteSizeText("GET / HTTP/1.1"), "14 B");
  // Multi-byte UTF-8 characters count bytes, not JS UTF-16 code units.
  assert.equal(byteSizeText("café"), "5 B");
  assert.equal(byteSizeText("a".repeat(2048)), "2.0 KB");
  assert.equal(byteSizeText("a".repeat(15 * 1024)), "15 KB");
});

test("shortcutTooltip appends the active shortcut when present and falls back to the plain label", () => {
  const keymap = {
    platform: "macos",
    bindingsFor: (id) => (id === "ledger.drawer-open.copy-raw-request" ? ["meta+shift+r"] : []),
  };
  assert.equal(shortcutTooltip("Copy request", "ledger.drawer-open.copy-raw-request", keymap), "Copy request (⌘⇧R)");
  assert.equal(shortcutTooltip("Prettify", "ledger.drawer-open.unknown", keymap), "Prettify");
  assert.equal(shortcutTooltip("Copy metadata", null, keymap), "Copy metadata");
  assert.equal(shortcutTooltip("Copy request", "ledger.drawer-open.copy-raw-request", null), "Copy request");
});

test("pairSummary presents pair number, method, status, host/path, full URL tooltip, timing, and protocol", () => {
  const at = (ms) => new Date(Date.UTC(2026, 10, 27, 12, 0, 0, ms)).toISOString();
  const completed = {
    ID: "p1",
    Scheme: "https",
    Method: "POST",
    StatusCode: 201,
    Host: "api.example.com",
    Path: "/v1/orders?limit=50",
    RequestedAt: at(0),
    RespondedAt: at(145),
    ClientProtocol: "h2",
    OriginProtocol: "http/1.1",
  };
  const summary = pairSummary(completed, { number: 42 });
  assert.equal(summary.number, "42");
  assert.equal(summary.method, "POST");
  assert.equal(summary.methodClass, "text-tertiary-700 dark:text-tertiary-500");
  assert.equal(summary.hasResponse, true);
  assert.equal(summary.statusCode, 201);
  assert.equal(summary.status, "201");
  assert.equal(summary.statusClass, "text-success-500");
  assert.equal(summary.host, "api.example.com");
  assert.equal(summary.path, "/v1/orders?limit=50");
  assert.equal(summary.fullUrl, "https://api.example.com/v1/orders?limit=50");
  assert.equal(summary.timing, "145 ms");
  assert.equal(summary.protocol, "h2→1.1");
  assert.equal(summary.protocolTitle, "client h2 · origin http/1.1");

  // Pending pair: status -1 (stored) or 0 (live) shows "pending" with no timing.
  const pending = {
    ID: "p2",
    Method: "GET",
    StatusCode: -1,
    Host: "example.com",
    Path: "/stream",
    RequestedAt: at(0),
  };
  const pendingSummary = pairSummary(pending, { number: 43 });
  assert.equal(pendingSummary.hasResponse, false);
  assert.equal(pendingSummary.status, "pending");
  assert.equal(pendingSummary.statusClass, "opacity-50");
  assert.equal(pendingSummary.fullUrl, "example.com/stream");
  assert.equal(pendingSummary.timing, "");
  assert.equal(pendingSummary.protocol, "");

  // Live incoming response updates status, hasResponse, and timing.
  const liveSummary = pairSummary(pending, {
    number: 43,
    incomingResponse: { StatusCode: 404, Raw: "HTTP/1.1 404 Not Found\r\n\r\n", RespondedAt: at(1250) },
  });
  assert.equal(liveSummary.hasResponse, true);
  assert.equal(liveSummary.status, "404");
  assert.equal(liveSummary.statusClass, "text-error-500");
  assert.equal(liveSummary.timing, "1.25 s");
});

test("pairHasResponse detects responded, pending, incoming, and body-present pairs", () => {
  assert.equal(pairHasResponse({ StatusCode: 200 }), true);
  assert.equal(pairHasResponse({ StatusCode: -1 }), false);
  assert.equal(pairHasResponse({ StatusCode: 0 }), false);
  assert.equal(pairHasResponse({ StatusCode: 0 }, { incomingResponse: { StatusCode: 204 } }), true);
  assert.equal(pairHasResponse({ StatusCode: 0 }, { incomingResponse: { Raw: "HTTP/1.1 200 OK" } }), true);
  assert.equal(pairHasResponse({ StatusCode: 0 }, { responseBody: "HTTP/1.1 200 OK" }), true);
});

test("commandStripCopyActions disables Copy response on pending pairs and gates Open messages", () => {
  const pending = commandStripCopyActions({ hasResponse: false, canOpenStream: false });
  assert.deepEqual(
    pending.map((a) => [a.id, a.actionId, a.disabled]),
    [
      ["copy-request", "ledger.drawer-open.copy-raw-request", false],
      ["copy-response", "ledger.drawer-open.copy-raw-response", true],
      ["copy-url", "ledger.drawer-open.copy-url", false],
      ["copy-browser-view-url", "ledger.drawer-open.copy-browser-view-url", false],
    ],
  );
  assert.equal(pending.find((a) => a.id === "copy-response").disabledHint, "No response yet");

  const streamed = commandStripCopyActions({ hasResponse: true, canOpenStream: true });
  assert.deepEqual(
    streamed.map((a) => [a.id, a.actionId, a.disabled]),
    [
      ["open-messages", "ledger.drawer-open.websocket.open-stream", false],
      ["copy-request", "ledger.drawer-open.copy-raw-request", false],
      ["copy-response", "ledger.drawer-open.copy-raw-response", false],
      ["copy-url", "ledger.drawer-open.copy-url", false],
      ["copy-browser-view-url", "ledger.drawer-open.copy-browser-view-url", false],
    ],
  );
  assert.equal(streamed[0].accent, true);
});

test("highlightSwatchTitle appends clear hint only on the active swatch", () => {
  const swatch = { number: 2, label: "Interesting", color: "#f59e0b" };
  assert.equal(highlightSwatchTitle(swatch, 1), "Interesting");
  assert.equal(highlightSwatchTitle(swatch, null), "Interesting");
  assert.equal(highlightSwatchTitle(swatch, 2), "Interesting (click to clear)");
});

test("noteIndicator maps note presence and save states to dots, titles, status labels, and heading tints", () => {
  assert.deepEqual(noteIndicator("saved", false), {
    dot: "",
    title: "Add a note",
    statusText: "",
    statusTone: "opacity-50",
    headingText: "",
    headingTint: "",
  });
  assert.deepEqual(noteIndicator("saved", true), {
    dot: "bg-surface-500 dark:bg-surface-300",
    title: "Note",
    statusText: "Saved",
    statusTone: "opacity-50",
    headingText: "",
    headingTint: "",
  });
  assert.deepEqual(noteIndicator("saved", true, { active: true }), {
    dot: "bg-surface-500 dark:bg-surface-300",
    title: "Note",
    statusText: "Saved",
    statusTone: "opacity-50",
    headingText: "",
    headingTint: "text-surface-900 dark:text-surface-50 !opacity-100",
  });
  assert.deepEqual(noteIndicator("unsaved", true, { active: true }), {
    dot: "bg-warning-500",
    title: "Note edited",
    statusText: "Edited",
    statusTone: "text-warning-500",
    headingText: "Edited",
    headingTint: "text-warning-500 !opacity-100",
  });
  assert.deepEqual(noteIndicator("saving", false, { active: true }), {
    dot: "bg-warning-500",
    title: "Saving the note…",
    statusText: "Saving…",
    statusTone: "text-warning-500",
    headingText: "Saving…",
    headingTint: "text-warning-500 !opacity-100",
  });
  assert.deepEqual(noteIndicator("failed", true, { active: true }), {
    dot: "bg-error-500",
    title: "Note not saved: close it or keep typing to try again",
    statusText: "Not saved",
    statusTone: "text-error-500",
    headingText: "Not saved",
    headingTint: "text-error-500 !opacity-100",
  });
});

test("paneHeaderState presents Request size/copy on the left and switches Response, Note, and Metadata on the right", () => {
  // Response pane on a responded pair.
  const responseState = paneHeaderState({
    pane: null,
    requestBody: "GET / HTTP/1.1",
    responseBody: "HTTP/1.1 200 OK\r\n\r\nok",
    hasResponse: true,
    hasNote: true,
    noteStatus: "saved",
  });
  assert.equal(responseState.left.label, "Request");
  assert.equal(responseState.left.sizeText, "14 B");
  assert.equal(responseState.left.copy.actionId, "ledger.drawer-open.copy-raw-request");
  assert.equal(responseState.right.activePane, null);
  assert.deepEqual(
    responseState.right.tabs.map((t) => [t.id, t.label, t.dot]),
    [
      [null, "Response", ""],
      ["note", "Note", "bg-surface-500 dark:bg-surface-300"],
      ["metadata", "Metadata", ""],
    ],
  );
  assert.equal(responseState.right.metaText, "21 B");
  assert.deepEqual(responseState.right.copy, {
    kind: "response",
    label: "Copy response",
    actionId: "ledger.drawer-open.copy-raw-response",
    disabled: false,
    disabledHint: "No response yet",
  });

  // Response pane on a pending pair disables Copy response.
  const pendingState = paneHeaderState({
    pane: null,
    requestBody: "GET /pending HTTP/1.1",
    responseBody: "",
    hasResponse: false,
  });
  assert.equal(pendingState.right.metaText, "");
  assert.equal(pendingState.right.copy.disabled, true);

  // Note pane hides Copy and shows note save state + dot.
  const noteState = paneHeaderState({
    pane: "note",
    requestBody: "GET / HTTP/1.1",
    responseBody: "HTTP/1.1 200 OK",
    hasResponse: true,
    hasNote: true,
    noteStatus: "saving",
  });
  assert.equal(noteState.right.activePane, "note");
  assert.equal(noteState.right.metaText, "Saving…");
  assert.equal(noteState.right.metaTone, "text-warning-500");
  assert.equal(noteState.right.tabs[1].dot, "bg-warning-500");
  assert.equal(noteState.right.copy, null);

  // Metadata pane shows Copy metadata, disabled while metadata is loading (null).
  const loadingMeta = paneHeaderState({ pane: "metadata", metadataBody: null });
  assert.equal(loadingMeta.right.metaText, "");
  assert.deepEqual(loadingMeta.right.copy, {
    kind: "metadata",
    label: "Copy metadata",
    actionId: null,
    disabled: true,
  });

  const loadedMeta = paneHeaderState({ pane: "metadata", metadataBody: '{\n  "ok": true\n}' });
  assert.equal(loadedMeta.right.copy.disabled, false);
});

test("rightRailWorkflowActions groups outbound workflow actions and gates Open messages and CyberChef", () => {
  const desktop = rightRailWorkflowActions({ canOpenStream: false, showChef: true });
  assert.deepEqual(
    desktop.map((a) => [a.id, a.group, a.actionId]),
    [
      ["send-to-launchpad", "send", "ledger.drawer-open.send-to-launchpad"],
      ["send-to-armory", "send", "ledger.drawer-open.send-to-armory"],
      ["add-to-drawing", "tools", "global.add-to-drawing"],
      ["send-to-cyberchef", "tools", "global.send-to-cyberchef"],
      ["create-finding", "record", "ledger.drawer-open.create-finding"],
      ["create-test-case", "record", "ledger.drawer-open.create-test-case"],
    ],
  );

  // Streamed/WebSocket pair prepends Open messages in its own stream group with accent.
  const streamed = rightRailWorkflowActions({ canOpenStream: true, showChef: true });
  assert.deepEqual(streamed[0], {
    id: "open-messages",
    label: "Open messages",
    icon: "radio",
    actionId: "ledger.drawer-open.websocket.open-stream",
    group: "stream",
    accent: true,
  });
  assert.equal(streamed.length, 7);

  // Phone width (showChef: false) leaves Send to CyberChef out while keeping Add to Drawing and Logbook actions.
  const phone = rightRailWorkflowActions({ canOpenStream: false, showChef: false });
  assert.deepEqual(
    phone.map((a) => a.id),
    ["send-to-launchpad", "send-to-armory", "add-to-drawing", "create-finding", "create-test-case"],
  );
});

test("drawerCopyActions lists all four copy actions and disables Copy response on pending pairs", () => {
  const pending = drawerCopyActions({ hasResponse: false });
  assert.deepEqual(
    pending.map((a) => [a.id, a.label, a.actionId, a.disabled]),
    [
      ["copy-request", "Copy request", "ledger.drawer-open.copy-raw-request", false],
      ["copy-response", "Copy response", "ledger.drawer-open.copy-raw-response", true],
      ["copy-url", "Copy URL", "ledger.drawer-open.copy-url", false],
      ["copy-browser-view-url", "Copy browser view URL", "ledger.drawer-open.copy-browser-view-url", false],
    ],
  );
  assert.equal(pending.find((a) => a.id === "copy-response").disabledHint, "No response yet");

  const responded = drawerCopyActions({ hasResponse: true });
  assert.equal(responded.find((a) => a.id === "copy-response").disabled, false);
});
