import { test } from "node:test";
import assert from "node:assert/strict";
import { createPaletteRegistry } from "./palettes.js";

test("the most specific registered menu is the one the menu shortcut toggles, whatever the mount order", () => {
  const palettes = createPaletteRegistry();
  const page = { name: "ledger" };
  const global = { name: "global" };
  const overlay = { name: "websocket" };
  palettes.register("page", page);
  palettes.register("global", global);
  assert.equal(palettes.active(), page);
  const closeOverlay = palettes.register("overlay", overlay);
  assert.equal(palettes.active(), overlay);
  closeOverlay();
  assert.equal(palettes.active(), page);
});

test("the global menu is used where a page has no menu of its own", () => {
  const palettes = createPaletteRegistry();
  const global = { name: "global" };
  palettes.register("global", global);
  const leave = palettes.register("page", { name: "ledger" });
  leave();
  assert.equal(palettes.active(), global);
});

test("within a tier the latest registration wins", () => {
  const palettes = createPaletteRegistry();
  const leaving = { name: "old page" };
  const arriving = { name: "new page" };
  const unregisterLeaving = palettes.register("page", leaving);
  palettes.register("page", arriving);
  unregisterLeaving();
  assert.equal(palettes.active(), arriving);
  assert.equal(createPaletteRegistry().active(), null);
});
