import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MARASI_API, TYPE_DEFINITIONS } from "./definitions.js";
import { GLOBAL_SNIPPETS } from "./snippets.js";

// marasiLuaReference.json is the Lua API of the pinned Marasi, recorded by
// scripts/record-lua-reference.sh. The editor's autocomplete is written by
// hand, so these tests keep it naming what Marasi registers.
const reference = JSON.parse(readFileSync(new URL("./marasiLuaReference.json", import.meta.url), "utf8"));

// Marasi's type names and the ones the autocomplete uses.
const TYPE_NAMES = {
  req: "http.Request",
  res: "http.Response",
  cookie: "http.Cookie",
  header: "http.Header",
  url: "url.URL",
  regexp: "regexp.Regexp",
  scope: "compass.Scope",
  wsmsg: "websocket.Message",
  RequestBuilder: "RequestBuilder",
};

// Every library under marasi, as "marasi.crypto.aes" → its function names.
function libraries(node, path, out = {}) {
  const functions = [];
  for (const [name, child] of Object.entries(node.children ?? {})) {
    if (child.type === "namespace") libraries(child, `${path}.${name}`, out);
    else functions.push(name);
  }
  if (functions.length) out[path] = functions.sort();
  return out;
}

test("the autocomplete lists every library function Marasi registers, and no other", () => {
  const want = Object.fromEntries(Object.entries(reference.libraries).map(([name, fns]) => [name, [...fns].sort()]));
  assert.deepEqual(libraries(MARASI_API.marasi, "marasi"), want);
});

test("the autocomplete lists every method of every type Marasi passes to Lua, and no other", () => {
  assert.deepEqual(Object.keys(reference.types).sort(), Object.keys(TYPE_NAMES).sort(), "a type without a mapping");
  for (const [name, methods] of Object.entries(reference.types)) {
    const ours = Object.keys(TYPE_DEFINITIONS[TYPE_NAMES[name]]?.methods ?? {}).sort();
    assert.deepEqual(ours, [...methods].sort(), `methods of ${name} (${TYPE_NAMES[name]})`);
  }
});

test("there is a snippet for every hook", () => {
  const labels = new Set(GLOBAL_SNIPPETS.map((snippet) => snippet.label));
  assert.deepEqual(
    reference.hooks.filter((hook) => !labels.has(hook)),
    [],
  );
});
