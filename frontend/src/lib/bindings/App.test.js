import { test } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { isNotPorted } from "./notPorted.js";

test("a binding that isn't ported rejects with a short not ported error", async () => {
  const error = await App.RunExtension().then(
    () => assert.fail("RunExtension resolved"),
    (err) => err,
  );
  assert.ok(isNotPorted(error));
  // The app's error helpers show String(error) after a colon.
  assert.equal(String(error), "not ported");
  assert.match(error.message, /RunExtension/);
});

test("every v1 binding the frontend imports is still exported", () => {
  for (const name of ["OpenProject", "QueryTraffic", "ForwardCheckpoints", "GetArmoryRuns", "SaveKeybindings"]) {
    assert.equal(typeof App[name], "function", name);
  }
});

test("other errors are not mistaken for not ported", () => {
  assert.equal(isNotPorted("not ported"), false);
  assert.equal(isNotPorted(new Error("not ported")), false);
  assert.equal(isNotPorted(undefined), false);
});

test("GetBuildInfo reports the app's own channel and version from the main process", async () => {
  globalThis.window = { marasiApp: { buildInfo: async () => ({ Channel: "dev", Version: "2.0.0-dev" }) } };
  try {
    assert.deepEqual(await App.GetBuildInfo(), { Channel: "dev", Version: "2.0.0-dev" });
  } finally {
    delete globalThis.window;
  }
});
