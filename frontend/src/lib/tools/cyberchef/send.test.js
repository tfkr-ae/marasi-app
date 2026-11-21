import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { editorTracker, pairText } from "./send.js";

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

test("Insert puts a pair's raw text in with LF line endings, as Send takes it from the Ledger", () => {
  assert.equal(pairText("GET / HTTP/1.1\r\nHost: a\r\n\r\nbody\r\n"), "GET / HTTP/1.1\nHost: a\n\nbody\n");
  assert.equal(pairText("a\nb"), "a\nb");
  assert.equal(pairText(null), "");
});
