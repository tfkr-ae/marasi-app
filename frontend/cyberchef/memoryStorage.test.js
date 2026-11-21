import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { MEMORY_STORAGE_SCRIPT, installMemoryStorage, withMemoryStorage } from "./memoryStorage.js";

test("the frame's localStorage keeps items in memory, by method and by property", () => {
  const win = {};
  const storage = installMemoryStorage(win);
  assert.equal(win.localStorage, storage);
  storage.setItem("options", '{"theme":"dark"}');
  assert.equal(storage.getItem("options"), '{"theme":"dark"}');
  assert.equal(storage.options, '{"theme":"dark"}');
  storage.savedRecipes = 1;
  assert.equal(storage.getItem("savedRecipes"), "1");
  assert.equal(storage.length, 2);
  assert.equal(storage.key(0), "options");
  assert.equal("savedRecipes" in storage, true);
  assert.deepEqual(Object.keys(storage), ["options", "savedRecipes"]);
  delete storage.savedRecipes;
  storage.removeItem("options");
  assert.equal(storage.getItem("options"), null);
  assert.equal(storage.missing, undefined);
  storage.setItem("a", "b");
  storage.clear();
  assert.equal(storage.length, 0);
});

test("the injected script stands alone and replaces the page's localStorage", () => {
  const source = /<script[^>]*>([\s\S]*)<\/script>/.exec(MEMORY_STORAGE_SCRIPT)[1];
  const real = { setItem() { throw new Error("reached the app's localStorage"); } };
  const window = { localStorage: real };
  vm.runInNewContext(source, { window });
  window.localStorage.setItem("theme", "dark");
  assert.equal(window.localStorage.getItem("theme"), "dark");
});

test("the script goes first in <head>, once", () => {
  const html = '<!DOCTYPE html><html><head lang="en"><script src="assets/main.js"></script></head></html>';
  const out = withMemoryStorage(html);
  assert.ok(out.indexOf("memory-storage") < out.indexOf("assets/main.js"));
  assert.ok(out.startsWith('<!DOCTYPE html><html><head lang="en"><script data-marasi="memory-storage">'));
  assert.equal(withMemoryStorage(out), out);
  assert.throws(() => withMemoryStorage("<html></html>"), /no <head>/);
});
