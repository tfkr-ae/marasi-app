import { test } from "node:test";
import assert from "node:assert/strict";
import { defineWebComponent, webComponentTag } from "./webComponent.js";

// A stand-in for window.customElements; `run` evaluates ui_code against it.
function registry() {
  const defined = new Map();
  return { get: (tag) => defined.get(tag), define: (tag, cls) => defined.set(tag, cls) };
}
const runWith = (reg) => (code) => new Function("customElements", code)(reg);

test("the tag is the extension's name, the target and its version", () => {
  assert.equal(webComponentTag("hello", "icon", "1"), "hello-icon-1");
  assert.equal(webComponentTag("hello", "extension", "2.0"), "hello-extension-2.0");
});

test("ui_code defines the element once", () => {
  const reg = registry();
  let runs = 0;
  const run = (code) => {
    runs++;
    runWith(reg)(code);
  };
  const code = 'customElements.define("hello-icon-1", class {})';
  assert.deepEqual(defineWebComponent("hello-icon-1", code, { registry: reg, run }), { error: null });
  assert.deepEqual(defineWebComponent("hello-icon-1", code, { registry: reg, run }), { error: null });
  assert.equal(runs, 1);
});

test("ui_code that throws or defines another tag is an error", () => {
  const reg = registry();
  const run = runWith(reg);
  assert.match(defineWebComponent("hello-icon-1", "throw new Error('boom')", { registry: reg, run }).error, /boom/);
  assert.equal(
    defineWebComponent("hello-icon-1", 'customElements.define("other-icon-1", class {})', { registry: reg, run }).error,
    "ui_code didn't define <hello-icon-1>",
  );
});
