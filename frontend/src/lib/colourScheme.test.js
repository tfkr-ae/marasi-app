import { test } from "node:test";
import assert from "node:assert/strict";
import { lightAtStartup } from "./colourScheme.js";

test("the researcher's choice wins over the system's scheme", () => {
  assert.equal(lightAtStartup(false, true), false);
  assert.equal(lightAtStartup(true, false), true);
});

test("without a choice the app follows the system", () => {
  assert.equal(lightAtStartup(undefined, true), true);
  assert.equal(lightAtStartup(undefined, false), false);
});
