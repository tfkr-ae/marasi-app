// Checkpoint's interception rules, kept in the editor's two stores, over a
// fake api standing in for the checkpoint extension.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import { createCheckpointRules } from "./checkpointRules.js";

function setup(lua = "-- held") {
  const extension = { lua, runs: [] };
  const api = {
    read: async () => extension.lua,
    run: async (code) => {
      extension.runs.push(code);
      if (code.includes("boom")) throw new Error("POST /extension/e2: lua_error: boom");
      extension.lua = code;
    },
  };
  const code = writable("");
  const applied = writable("");
  return { extension, rules: createCheckpointRules(api, { code, applied }), code, applied };
}

test("load reads the rules into the editor", async () => {
  const { rules, code, applied } = setup("return true");
  await rules.load();
  assert.deepEqual([get(code), get(applied)], ["return true", "return true"]);
});

test("apply runs the rules, then marks them applied", async () => {
  const { extension, rules, code, applied } = setup();
  await rules.load();
  code.set("-- new");
  await rules.apply("-- new");
  assert.deepEqual(extension.runs, ["-- new"]);
  assert.equal(get(applied), "-- new");
});

test("rules that fail to run are refused with the Lua error and stay unapplied", async () => {
  const { rules, code, applied } = setup();
  await rules.load();
  code.set("boom");
  await assert.rejects(rules.apply("boom"), /lua_error: boom/);
  assert.deepEqual([get(code), get(applied)], ["boom", "-- held"]);
});

test("resync takes the service's rules, keeping an edit not yet applied", async () => {
  const { extension, rules, code, applied } = setup("-- one");
  await rules.load();
  extension.lua = "-- two";
  await rules.resync();
  assert.deepEqual([get(code), get(applied)], ["-- two", "-- two"]);

  code.set("-- my edit");
  extension.lua = "-- three";
  await rules.resync();
  assert.deepEqual([get(code), get(applied)], ["-- my edit", "-- three"]);
});
