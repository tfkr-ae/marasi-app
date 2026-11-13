import { test } from "node:test";
import assert from "node:assert/strict";
import { platformOf } from "./platform.js";

test("iOS and Android are the mobile platforms; every other OS is the desktop", () => {
  assert.equal(platformOf("ios"), "ios");
  assert.equal(platformOf("android"), "android");
  for (const os of ["darwin", "windows", "linux", "", undefined]) assert.equal(platformOf(os), "desktop");
});
