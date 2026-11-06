// Checkpoint's interception rules: the `checkpoint` extension's Lua, read
// and run through the service's /extension routes (createRulesApi over a
// fake client) and kept in the editor's two stores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import { serviceError } from "../lib/service/errors.js";
import { createCheckpointRules, createRulesApi } from "./checkpointRules.js";

function fakeExtensions(lua = "-- held") {
  const state = { lua, calls: [] };
  state.client = {
    get: async (path) => {
      state.calls.push(["GET", path]);
      if (path === "/extension") return { items: [{ id: "e1", name: "compass" }, { id: "e2", name: "checkpoint" }] };
      if (path === "/extension/e2") return { id: "e2", name: "checkpoint", lua_content: state.lua, settings: {} };
      throw serviceError({ method: "GET", path, status: 404, body: { error: "not_found" } });
    },
    post: async (path, body) => {
      state.calls.push(["POST", path, body]);
      if (body.lua_content.includes("boom")) {
        throw serviceError({ method: "POST", path, status: 400, body: { error: "lua_error", message: "boom" } });
      }
      state.lua = body.lua_content;
      return { id: "e2", lua_content: state.lua };
    },
  };
  return state;
}

function setup(lua) {
  const marasi = fakeExtensions(lua);
  const code = writable("");
  const applied = writable("");
  const rules = createCheckpointRules(createRulesApi(marasi.client), { code, applied });
  return { marasi, rules, code, applied };
}

test("load reads the checkpoint extension's Lua, found by name", async () => {
  const { rules, code, applied } = setup("return true");
  await rules.load();
  assert.deepEqual([get(code), get(applied)], ["return true", "return true"]);
});

test("apply runs the rules on the service, then marks them applied", async () => {
  const { marasi, rules, code, applied } = setup();
  await rules.load();
  code.set("-- new");
  await rules.apply("-- new");
  assert.deepEqual(marasi.calls.at(-1), ["POST", "/extension/e2", { lua_content: "-- new" }]);
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
  const { marasi, rules, code, applied } = setup("-- one");
  await rules.load();
  marasi.lua = "-- two";
  await rules.resync();
  assert.deepEqual([get(code), get(applied)], ["-- two", "-- two"]);

  code.set("-- my edit");
  marasi.lua = "-- three";
  await rules.resync();
  assert.deepEqual([get(code), get(applied)], ["-- my edit", "-- three"]);
});
