import assert from "node:assert/strict";
import { test } from "node:test";
import { handleUpdates, updateCalls } from "./updateIPC.js";

function fakeIPC() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

test("each updater call is handled on its own channel with the renderer's arguments", async () => {
  const ipc = fakeIPC();
  const updater = { setUpdateChannel: async (name) => ({ Settings: { Channel: name } }) };
  handleUpdates(ipc, updater);
  for (const name of updateCalls) assert.ok(ipc.handlers.has(`update:${name}`), name);
  assert.deepEqual(await ipc.handlers.get("update:setUpdateChannel")({}, "v2-nightly"), {
    value: { Settings: { Channel: "v2-nightly" } },
  });
});

test("a refusal comes back as its message", async () => {
  const ipc = fakeIPC();
  handleUpdates(ipc, { installUpdate: async () => Promise.reject(new Error("there is no update to install")) });
  assert.deepEqual(await ipc.handlers.get("update:installUpdate")({}), { error: "there is no update to install" });
});
