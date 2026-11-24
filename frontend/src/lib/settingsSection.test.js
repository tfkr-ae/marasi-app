// Which Settings section a ?section= link opens, and legacy redirects to Connections.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsSection } from "./settingsSection.js";

const desktopIds = ["appearance", "updates", "about"];
const mobileIds = ["appearance", "about"];

test("a listed section opens with no part", () => {
  assert.deepEqual(settingsSection("about", "", desktopIds), {
    section: "about",
    part: null,
    openConnections: false,
  });
  assert.deepEqual(settingsSection("updates", "", desktopIds), {
    section: "updates",
    part: null,
    openConnections: false,
  });
});

test("an unknown, hidden, or missing section opens nothing", () => {
  assert.equal(settingsSection("nope", "", desktopIds), null);
  assert.equal(settingsSection(null, "", desktopIds), null);
  assert.equal(settingsSection("updates", "", mobileIds), null);
});

test("legacy ?section=connection, ?section=cli, and ?section=updates#cli open Connections on desktop and mobile", () => {
  for (const ids of [desktopIds, mobileIds]) {
    assert.deepEqual(settingsSection("connection", "", ids), {
      section: null,
      part: null,
      openConnections: true,
    });
    assert.deepEqual(settingsSection("cli", "", ids), {
      section: null,
      part: null,
      openConnections: true,
    });
    assert.deepEqual(settingsSection("updates", "#cli", ids), {
      section: null,
      part: null,
      openConnections: true,
    });
  }
});

test("a hash fragment on a listed section targets that part", () => {
  assert.deepEqual(settingsSection("about", "#licences", desktopIds), {
    section: "about",
    part: "licences",
    openConnections: false,
  });
});
