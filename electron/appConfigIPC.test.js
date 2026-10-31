import { test } from "node:test";
import assert from "node:assert/strict";
import { appConfigCalls, handleAppConfig } from "./appConfigIPC.js";

function fakeIPC() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

test("each app config call is handled on its own channel with the renderer's arguments", async () => {
  const ipc = fakeIPC();
  const seen = [];
  const appConfig = { setFlag: async (...args) => (seen.push(args), { TextSize: args[1] }) };
  handleAppConfig(ipc, { appConfig, keybindingFiles: {} });
  for (const name of appConfigCalls) assert.ok(ipc.handlers.has(`appConfig:${name}`), name);
  const reply = await ipc.handlers.get("appConfig:setFlag")({}, "text_size", "large");
  assert.deepEqual(reply, { value: { TextSize: "large" } });
  assert.deepEqual(seen, [["text_size", "large"]]);
});

test("a refusal comes back as its message, not a thrown IPC error", async () => {
  const ipc = fakeIPC();
  const appConfig = { toggleFlag: async () => { throw new Error("toggling flag : x is not a switch"); } };
  handleAppConfig(ipc, { appConfig, keybindingFiles: {} });
  assert.deepEqual(await ipc.handlers.get("appConfig:toggleFlag")({}, "x"), {
    error: "toggling flag : x is not a switch",
  });
});

test("profile files go to the keybinding file module", async () => {
  const ipc = fakeIPC();
  const keybindingFiles = { exportProfile: async (name, text) => `/d/${name}:${text}` };
  handleAppConfig(ipc, { appConfig: {}, keybindingFiles });
  assert.deepEqual(await ipc.handlers.get("appConfig:exportProfile")({}, "a.json", "{}"), { value: "/d/a.json:{}" });
});
