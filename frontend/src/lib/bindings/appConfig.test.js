import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppConfigBindings } from "./appConfig.js";
import { buildCatalog } from "../keybindings/catalog.js";
import { catalogDescriptor, factoryKeybindings } from "../keybindings/profiles.js";

// A bridge like the preload's: each call resolves { value } or { error }.
function fakeBridge(replies = {}) {
  const calls = [];
  const bridge = new Proxy(
    {},
    {
      get: (_, name) => async (...args) => {
        calls.push([name, ...args]);
        const reply = replies[name];
        return typeof reply === "function" ? reply(...args) : (reply ?? { value: null });
      },
    },
  );
  return { calls, bindings: createAppConfigBindings(() => bridge) };
}

test("a binding resolves the main process's value", async () => {
  const { calls, bindings } = fakeBridge({ setFlag: { value: { TextSize: "large" } } });
  assert.deepEqual(await bindings.SetFlag("text_size", "large"), { TextSize: "large" });
  assert.deepEqual(calls, [["setFlag", "text_size", "large"]]);
});

test("a refusal rejects with its message, shown as text the way Wails errors were", async () => {
  const { bindings } = fakeBridge({ toggleFlag: { error: "toggling flag : x is not a switch" } });
  const error = await bindings.ToggleFlag("x").catch((e) => e);
  assert.equal(error.message, "toggling flag : x is not a switch");
  assert.equal(String(error), "toggling flag : x is not a switch");
});

test("without the app window's bridge, a call says it needs the app", async () => {
  const bindings = createAppConfigBindings(() => undefined);
  await assert.rejects(bindings.GetMarasiConfig(), /needs the Marasi app window/);
});

const catalog = buildCatalog();

// A profile last saved against this catalog, so the new-default rule
// leaves its defaults alone.
function withOverride(action, keys) {
  const config = factoryKeybindings();
  config.profiles[0].overrides.macos = [{ action, keys }];
  config.profiles[0].knownActions = catalog.actions.map((a) => a.id).sort();
  return config;
}

test("saving keybindings checks them against the catalog and sends them settled", async () => {
  const { calls, bindings } = fakeBridge({ saveKeybindings: (config) => ({ value: { config, problem: "" } }) });
  const state = await bindings.SaveKeybindings(withOverride("global.go-ledger", ["ctrl+alt+y"]), catalogDescriptor(catalog));
  const [[name, sent]] = calls;
  assert.equal(name, "saveKeybindings");
  assert.deepEqual(sent.profiles[0].overrides.macos, [{ action: "global.go-ledger", keys: ["ctrl+alt+y"] }]);
  assert.deepEqual(sent.profiles[0].knownActions, catalog.actions.map((a) => a.id).sort());
  assert.deepEqual(state.config, sent);
});

test("keybindings with a conflict or an unbound menu are refused before anything is written", async () => {
  const { calls, bindings } = fakeBridge();
  await assert.rejects(
    bindings.SaveKeybindings(withOverride("global.go-ledger", ["meta+k"]), catalogDescriptor(catalog)),
    /invalid keybindings: .*meta\+k/,
  );
  await assert.rejects(
    bindings.SaveKeybindings(withOverride("global.open-menu", []), catalogDescriptor(catalog)),
    /invalid keybindings: .*menu opening is unbound/,
  );
  assert.deepEqual(calls, []);
});

test("the default exclusion is normalised as Marasi does, and a malformed type refused", async () => {
  const { calls, bindings } = fakeBridge();
  await bindings.SetDefaultContentTypeExclusion([" Image/PNG; q=1", "font/*"]);
  assert.deepEqual(calls, [["setDefaultContentTypeExclusion", ["image/png", "font/*"]]]);
  await assert.rejects(bindings.SetDefaultContentTypeExclusion(["image"]), /invalid content-type exclusion "image"/);
  await assert.rejects(bindings.SetDefaultContentTypeExclusion(["*/png"]), /\* may only stand for a whole subtype/);
});

test("profile files go through the main process's dialogs", async () => {
  const { calls, bindings } = fakeBridge({ importProfile: { value: { path: "/p.json", contents: "{}" } } });
  assert.deepEqual(await bindings.ImportKeybindingProfile(), { path: "/p.json", contents: "{}" });
  await bindings.ExportKeybindingProfile("mine.json", "{}");
  assert.deepEqual(calls, [["importProfile"], ["exportProfile", "mine.json", "{}"]]);
});

test("v1's one-time highlight migration is dropped: it reports that it didn't run", async () => {
  const { calls, bindings } = fakeBridge();
  assert.deepEqual(await bindings.MigrateOldHighlights(), { Ran: false, Highlighted: 0, Cleared: 0 });
  assert.deepEqual(calls, []);
});
