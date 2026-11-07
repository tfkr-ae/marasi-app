// Which Settings section a ?section= link opens, and which part of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsSection } from "./settingsSection.js";

const ids = ["appearance", "updates", "about"];

test("a listed section opens with no part", () => {
  assert.deepEqual(settingsSection("about", "", ids), { section: "about", part: null });
});

test("an unknown or missing section opens nothing", () => {
  assert.equal(settingsSection("nope", "", ids), null);
  assert.equal(settingsSection(null, "", ids), null);
});

test("the old Marasi CLI section opens Updates at its CLI part", () => {
  assert.deepEqual(settingsSection("cli", "", ids), { section: "updates", part: "cli" });
});

test("#cli on Updates targets the CLI part", () => {
  assert.deepEqual(settingsSection("updates", "#cli", ids), { section: "updates", part: "cli" });
});
