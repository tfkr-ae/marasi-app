import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBinding, bindingFromEvent, formatBinding } from "./keys.js";

test("legacy menu notation normalizes to one canonical binding", () => {
  assert.equal(normalizeBinding("⌘+⇧+F"), "meta+shift+f");
  assert.equal(normalizeBinding("ctrl+⇧+enter"), "ctrl+shift+enter");
  assert.equal(normalizeBinding("⌘+⇧+↩"), "meta+shift+enter");
  assert.equal(normalizeBinding("⌘+⇧+down"), "meta+shift+arrowdown");
  assert.equal(normalizeBinding("cmd+k"), "meta+k");
});

test("modifier order and spelling do not change a binding", () => {
  assert.equal(normalizeBinding("shift+alt+Meta+X"), "meta+alt+shift+x");
  assert.equal(normalizeBinding("Control+Option+1"), "ctrl+alt+1");
});

test("incomplete or unknown notation is not a binding", () => {
  assert.equal(normalizeBinding(""), null);
  assert.equal(normalizeBinding("meta+shift"), null);
  assert.equal(normalizeBinding("hyper+k"), null);
  assert.equal(normalizeBinding("meta+k+j"), null);
});

const event = (key, code, mods = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("a letter shortcut matches regardless of the reported letter case", () => {
  assert.equal(bindingFromEvent(event("S", "KeyS", { metaKey: true, shiftKey: true })), "meta+shift+s");
  assert.equal(bindingFromEvent(event("s", "KeyS", { metaKey: true, shiftKey: true })), "meta+shift+s");
});

test("a shifted punctuation key resolves to the character on its unshifted key", () => {
  // A real US keyboard reports ⌘⇧[ as "{"; the CDP driver reports "[".
  assert.equal(bindingFromEvent(event("{", "BracketLeft", { metaKey: true, shiftKey: true })), "meta+shift+[");
  assert.equal(bindingFromEvent(event("[", "BracketLeft", { metaKey: true, shiftKey: true })), "meta+shift+[");
  assert.equal(bindingFromEvent(event("!", "Digit1", { ctrlKey: true, shiftKey: true })), "ctrl+shift+1");
});

test("an Option-modified character resolves to its base key", () => {
  assert.equal(bindingFromEvent(event("¡", "Digit1", { metaKey: true, altKey: true })), "meta+alt+1");
  assert.equal(bindingFromEvent(event("å", "KeyA", { metaKey: true, altKey: true })), "meta+alt+a");
  assert.equal(bindingFromEvent(event("Dead", "KeyE", { metaKey: true, altKey: true })), "meta+alt+e");
});

test("a shifted letter from a non-US layout stays logical", () => {
  assert.equal(bindingFromEvent(event("Ü", "BracketLeft", { metaKey: true, shiftKey: true })), "meta+shift+ü");
});

test("unshifted characters are taken logically, not from the physical key", () => {
  // AZERTY: the Digit1 key produces "&".
  assert.equal(bindingFromEvent(event("&", "Digit1", { metaKey: true })), "meta+&");
});

test("named keys use their logical names", () => {
  assert.equal(bindingFromEvent(event("ArrowDown", "ArrowDown", { metaKey: true, shiftKey: true })), "meta+shift+arrowdown");
  assert.equal(bindingFromEvent(event("Enter", "Enter", { ctrlKey: true, shiftKey: true })), "ctrl+shift+enter");
  assert.equal(bindingFromEvent(event(" ", "Space", { ctrlKey: true })), "ctrl+space");
});

test("modifier-only and composition events are not bindings", () => {
  assert.equal(bindingFromEvent(event("Meta", "MetaLeft", { metaKey: true })), null);
  assert.equal(bindingFromEvent(event("Shift", "ShiftLeft", { shiftKey: true })), null);
  assert.equal(bindingFromEvent(event("k", "KeyK", { isComposing: true })), null);
  assert.equal(bindingFromEvent(event("Process", "KeyK", { keyCode: 229 })), null);
});

test("bindings display in the palette's existing notation for each platform", () => {
  assert.equal(formatBinding("meta+shift+f", "macos"), "⌘+⇧+F");
  assert.equal(formatBinding("ctrl+shift+f", "windows-linux"), "ctrl+⇧+F");
  assert.equal(formatBinding("meta+alt+1", "macos"), "⌘+alt+1");
  assert.equal(formatBinding("meta+shift+enter", "macos"), "⌘+⇧+↩");
  assert.equal(formatBinding("ctrl+shift+enter", "windows-linux"), "ctrl+⇧+enter");
  assert.equal(formatBinding("meta+shift+arrowdown", "macos"), "⌘+⇧+down");
  assert.equal(formatBinding("meta+`", "macos"), "⌘+`");
});
