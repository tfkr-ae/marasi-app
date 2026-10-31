import { test } from "node:test";
import assert from "node:assert/strict";
import { createUpdateBindings } from "./updates.js";

test("an updater binding calls the main process with its arguments and resolves its value", async () => {
  const seen = [];
  const bindings = createUpdateBindings(() => ({
    setUpdateChannel: async (...args) => (seen.push(args), { value: { Settings: { Channel: args[0] } } }),
  }));
  assert.deepEqual(await bindings.SetUpdateChannel("v2-nightly"), { Settings: { Channel: "v2-nightly" } });
  assert.deepEqual(seen, [["v2-nightly"]]);
});

test("a refusal rejects with its message, as v1's Wails errors read", async () => {
  const bindings = createUpdateBindings(() => ({ installUpdate: async () => ({ error: "there is no update to install" }) }));
  const error = await bindings.InstallUpdate().then(() => assert.fail("resolved"), (err) => err);
  assert.equal(String(error), "there is no update to install");
});

test("outside the app window the bindings say they need it", async () => {
  await assert.rejects(createUpdateBindings(() => undefined).GetUpdateState(), /need the Marasi app window/);
});
