import { test } from "node:test";
import assert from "node:assert/strict";
import { MACOS, platformFromDesktopOS, WINDOWS_LINUX } from "./platform.js";

test("macOS and iOS take the ⌘ bindings; every other OS the Ctrl ones", () => {
  assert.equal(platformFromDesktopOS("darwin"), MACOS);
  assert.equal(platformFromDesktopOS("ios"), MACOS);
  for (const os of ["windows", "linux", "android", undefined]) assert.equal(platformFromDesktopOS(os), WINDOWS_LINUX);
});
