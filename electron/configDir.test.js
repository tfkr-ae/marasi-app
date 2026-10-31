import { test } from "node:test";
import assert from "node:assert/strict";
import { marasiConfigDir } from "./configDir.js";

test("the config dir is Marasi's, under the OS config dir, as v1 and the CLI use", () => {
  assert.equal(marasiConfigDir({ appData: "/Users/r/Library/Application Support" }), "/Users/r/Library/Application Support/Marasi");
});

test("--config-dir points the app at another dir, such as a test's temp dir", () => {
  assert.equal(marasiConfigDir({ appData: "/Users/r/Library/Application Support", configDirSwitch: "/tmp/mv2.x" }), "/tmp/mv2.x");
});
