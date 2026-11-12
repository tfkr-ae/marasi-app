import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "./catalog.js";
import { menuGroupId } from "./menuGroups.js";
import { PLATFORMS } from "./platform.js";

// The factory shortcuts are pinned in defaults.fixture.json, so changing a
// default key or menu letter shows up in the diff instead of slipping in
// with another change. Researchers learn these keys; change one only on
// purpose. To accept a deliberate change, regenerate the fixture:
//
//   UPDATE_KEYBINDING_DEFAULTS=1 node --test src/lib/keybindings/defaults.test.js

const FIXTURE = fileURLToPath(new URL("./defaults.fixture.json", import.meta.url));

function currentDefaults() {
  const catalog = buildCatalog();
  const actions = {};
  for (const action of catalog.actions) {
    actions[action.id] = Object.fromEntries(PLATFORMS.map((p) => [p, [...action.defaults[p]]]));
  }
  const menuGroupLetters = Object.fromEntries(catalog.groups.map((g) => [menuGroupId(g), g.letter]));
  return { actions, menuGroupLetters };
}

// One line per action or group, so a changed default is a one-line diff.
function serialize({ actions, menuGroupLetters }) {
  const block = (entries) =>
    Object.entries(entries)
      .map(([id, value]) => `    ${JSON.stringify(id)}: ${JSON.stringify(value)}`)
      .join(",\n");
  return `{\n  "actions": {\n${block(actions)}\n  },\n  "menuGroupLetters": {\n${block(menuGroupLetters)}\n  }\n}\n`;
}

function diff(expected, actual) {
  const lines = [];
  for (const section of ["actions", "menuGroupLetters"]) {
    const ids = new Set([...Object.keys(expected[section] ?? {}), ...Object.keys(actual[section])]);
    for (const id of [...ids].sort()) {
      const was = JSON.stringify(expected[section]?.[id]);
      const now = JSON.stringify(actual[section][id]);
      if (was !== now) lines.push(`  ${id}: fixture ${was ?? "(missing)"}, catalog ${now ?? "(missing)"}`);
    }
  }
  return lines;
}

test("every factory default shortcut and menu letter matches defaults.fixture.json", () => {
  const actual = currentDefaults();
  if (process.env.UPDATE_KEYBINDING_DEFAULTS) {
    writeFileSync(FIXTURE, serialize(actual));
  }
  const expected = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const changes = diff(expected, actual);
  assert.deepEqual(
    changes,
    [],
    "A default shortcut changed. Default shortcuts must not change silently: " +
      "if this change is deliberate, update src/lib/keybindings/defaults.fixture.json on purpose " +
      "(UPDATE_KEYBINDING_DEFAULTS=1 node --test src/lib/keybindings/defaults.test.js) and say so in the PR. " +
      `Changed:\n${changes.join("\n")}`,
  );
});
