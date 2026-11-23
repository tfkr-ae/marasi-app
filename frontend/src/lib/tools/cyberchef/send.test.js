import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { editorTracker } from "./send.js";

// A CodeMirror editor's DOM as the tracker sees it: `.cm-editor` itself,
// inside the Ledger query box or not, and the view behind it.
function editor(doc, { from, to, query = false } = {}) {
  const selection = from == null ? undefined : EditorSelection.single(from, to);
  const view = { state: EditorState.create({ doc, selection }) };
  const el = {
    isConnected: true,
    view,
    closest: (selector) => (selector === ".cm-editor" ? el : selector === ".ledger-query" && query ? {} : null),
  };
  // A focus target inside the editor's content.
  const target = { closest: (selector) => el.closest(selector) };
  return { el, target };
}

const tracker = () => editorTracker((el) => el.view);

test("sends the selection of the last focused editor", () => {
  const send = tracker();
  const { target } = editor("GET /?token=abc123 HTTP/1.1", { from: 12, to: 18 });
  send.focused(target);
  assert.deepEqual(send.text(), { text: "abc123" });
});

test("sends the whole editor when nothing is selected", () => {
  const send = tracker();
  send.focused(editor("line one\nline two").target);
  assert.deepEqual(send.text(), { text: "line one\nline two" });
});

test("focus outside an editor keeps the last editor", () => {
  const send = tracker();
  send.focused(editor("body").target);
  send.focused({ closest: () => null });
  assert.deepEqual(send.text(), { text: "body" });
});

test("the Ledger query editor is refused", () => {
  const send = tracker();
  send.focused(editor("body").target);
  send.focused(editor("host = example.com", { query: true }).target);
  assert.deepEqual(send.text(), { refused: "query" });
});

test("no editor, or one that has gone, gives nothing to send", () => {
  const send = tracker();
  assert.deepEqual(send.text(), { refused: "none" });
  const { el, target } = editor("body");
  send.focused(target);
  el.isConnected = false;
  assert.deepEqual(send.text(), { refused: "none" });
});

test("the inbox goes into CyberChef in the order sent, and empties", async () => {
  const { writable, get } = await import("svelte/store");
  const { drainInbox } = await import("./send.js");
  const inbox = writable(["first", "second"]);
  const inserted = [];
  await drainInbox(inbox, { insertInput: async (text) => inserted.push(text) });
  assert.deepEqual(inserted, ["first", "second"]);
  assert.deepEqual(get(inbox), []);
});

test("Insert records the source of the tab its text landed in; Send to CyberChef records none", async () => {
  const { writable } = await import("svelte/store");
  const { drainInbox } = await import("./send.js");
  const source = { pairId: 41, part: "request", bodyOnly: false };
  const inbox = writable(["sent from an editor", { text: "GET / HTTP/1.1\n\n", source }]);
  let tab = 0;
  const recorded = [];
  await drainInbox(inbox, { insertInput: async () => tab++, openTab: () => tab }, (num, src) => recorded.push([num, src]));
  assert.deepEqual(recorded, [[2, { ...source, inserted: "GET / HTTP/1.1\n\n" }]]);
});

test("a recipe's sources follow its input tabs, and a removed tab's source goes", async () => {
  const { sourcesByTab, sourcesOfTabs } = await import("./send.js");
  const a = { pairId: 1, part: "request", bodyOnly: false, inserted: "a" };
  const c = { pairId: 3, part: "response", bodyOnly: true, inserted: "c" };
  // A recipe loads into tabs 1 to 3, the second typed in.
  const byTab = sourcesByTab([1, 2, 3], [a, null, c]);
  assert.equal(byTab.get(1), a);
  assert.equal(byTab.has(2), false);
  // Tab 2 is removed and a typed tab 4 added: the recipe records by position.
  assert.deepEqual(sourcesOfTabs([1, 3, 4], byTab), [a, c, null]);
  // A recipe from before sources, or one with no list, has none.
  assert.equal(sourcesByTab([1, 2], undefined).size, 0);
});

// A pair's raw messages as Insert reads them (RAW_ONLY), in CRLF.
const details = {
  Request: { Raw: 'POST /login HTTP/1.1\r\nHost: a\r\n\r\n{"user":"alice"}' },
  Response: { Raw: "HTTP/1.1 200 OK\r\nSet-Cookie: s=1\r\n\r\nwelcome\r\nback" },
};

test("a swap gives each part, whole or body only, with LF line endings", async () => {
  const { swapInput } = await import("./send.js");
  const from = { pairId: 41, part: "request", bodyOnly: false, inserted: "POST /login HTTP/1.1\nHost: a\n\n" + '{"user":"alice"}' };
  const text = (part, bodyOnly) => swapInput(from, from.inserted, details, { part, bodyOnly }).text;
  assert.equal(text("request", false), 'POST /login HTTP/1.1\nHost: a\n\n{"user":"alice"}');
  assert.equal(text("request", true), '{"user":"alice"}');
  assert.equal(text("response", false), "HTTP/1.1 200 OK\nSet-Cookie: s=1\n\nwelcome\nback");
  assert.equal(text("response", true), "welcome\nback");
});

test("a swap's new source records the part and the text it put in", async () => {
  const { swapInput } = await import("./send.js");
  const from = { pairId: 41, part: "request", bodyOnly: false, inserted: "x" };
  assert.deepEqual(swapInput(from, "x", details, { part: "response", bodyOnly: true }).source, {
    pairId: 41,
    part: "response",
    bodyOnly: true,
    inserted: "welcome\nback",
  });
});

test("a message with no body gives an empty body", async () => {
  const { swapInput } = await import("./send.js");
  const from = { pairId: 1, part: "request", bodyOnly: false, inserted: "" };
  const got = swapInput(from, "", { Request: { Raw: "GET / HTTP/1.1\r\nHost: a" } }, { part: "request", bodyOnly: true });
  assert.equal(got.text, "");
});

test("swapping an unedited input doesn't ask; an edited one does", async () => {
  const { swapInput } = await import("./send.js");
  const from = { pairId: 41, part: "request", bodyOnly: false, inserted: "as inserted" };
  const want = { part: "response", bodyOnly: false };
  assert.equal(swapInput(from, "as inserted", details, want).ask, false);
  assert.equal(swapInput(from, "as inserted, then edited", details, want).ask, true);
});

test("a pair with no response yet can't swap to it", async () => {
  const { swapInput } = await import("./send.js");
  const from = { pairId: 41, part: "request", bodyOnly: false, inserted: "x" };
  const pending = { Request: details.Request, Response: { Raw: "" } };
  assert.deepEqual(swapInput(from, "x", pending, { part: "response", bodyOnly: false }), { refused: "no response" });
  assert.deepEqual(swapInput(from, "x", { Request: details.Request }, { part: "response", bodyOnly: true }), { refused: "no response" });
});
