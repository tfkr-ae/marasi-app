import { test } from "node:test";
import assert from "node:assert/strict";
import { CHEF_ACTIONS, hiddenInMenu, platformOf } from "./platform.js";

test("iOS and Android are the mobile platforms; every other OS is the desktop", () => {
  assert.equal(platformOf("ios"), "ios");
  assert.equal(platformOf("android"), "android");
  for (const os of ["darwin", "windows", "linux", "", undefined]) assert.equal(platformOf(os), "desktop");
});

test("⌘K leaves out what the platform can't run: Chrome and updates on mobile, CyberChef without room for it", () => {
  const desktop = { mobile: false, chefShown: true };
  const tablet = { mobile: true, chefShown: true };
  const phone = { mobile: true, chefShown: false };
  assert.equal(hiddenInMenu("global.start-chrome", desktop), false);
  assert.equal(hiddenInMenu("global.start-chrome", tablet), true);
  assert.equal(hiddenInMenu("global.go-cyberchef", tablet), false);
  for (const id of CHEF_ACTIONS) assert.equal(hiddenInMenu(id, phone), true, id);
  assert.equal(hiddenInMenu("global.go-excalidraw", phone), false);
});
